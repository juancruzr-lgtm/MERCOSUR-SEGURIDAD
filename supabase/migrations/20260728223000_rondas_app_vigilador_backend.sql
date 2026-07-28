/*
================================================================================
ETAPA 3.2 — APP VIGILADOR: registro de puntos, GPS, foto y cierre automático
================================================================================

ALCANCE
  Soporte transaccional que necesita la aplicación móvil para resolver un punto
  de una ronda en curso. La interfaz se integra después de verificar esta base.

INVARIANTES
  * El vigilador sólo puede operar su ejecución del turno vigente.
  * Sólo se resuelve el primer punto pendiente.
  * Identidad, orden, veredicto y hora son determinados por el servidor.
  * Una foto obligatoria debe existir realmente en Storage y en evidencias.
  * El doble toque es idempotente.
  * El último punto finaliza la ejecución automáticamente.
  * No se concede escritura directa sobre las tablas de ejecución.

ROLLBACK
  supabase/rollback/20260728223000_rondas_app_vigilador_backend_rollback.sql
================================================================================
*/

begin;

-- ── Storage privado para evidencias de puntos ────────────────────────────────

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'ronda-evidencias',
  'ronda-evidencias',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No se crean policies de escritura para authenticated. La carga pasa por una
-- ruta de servidor autenticada que usa service_role luego de verificar turno,
-- guardia, ejecución y punto. El bucket permanece privado.

-- ── Integridad de evidencias de Rondas ───────────────────────────────────────

create or replace function public.rondas_validar_evidencia_punto()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  v_ejecucion_id uuid;
  v_turno_id     uuid;
  v_guardia_id   uuid;
  v_objetivo_id  uuid;
  v_path         text;
begin
  if new.proceso_tipo <> 'ronda' then
    return new;
  end if;

  select e.id, e.turno_id, e.guardia_id, e.objetivo_id
    into v_ejecucion_id, v_turno_id, v_guardia_id, v_objetivo_id
    from public.ronda_ejecucion_puntos ep
    join public.ronda_ejecuciones e on e.id = ep.ronda_ejecucion_id
   where ep.id = new.proceso_id;

  if v_ejecucion_id is null then
    raise exception 'Punto de ejecución de ronda inexistente';
  end if;

  if new.tipo_evidencia <> 'punto_control' then
    raise exception 'Tipo de evidencia de ronda inválido';
  end if;

  if new.bucket <> 'ronda-evidencias' then
    raise exception 'Bucket de evidencia de ronda inválido';
  end if;

  v_path := v_ejecucion_id::text || '/' || new.proceso_id::text || '/punto';
  if new.storage_path <> v_path then
    raise exception 'Ruta de evidencia de ronda inválida';
  end if;

  if not exists (
    select 1
      from storage.objects o
     where o.bucket_id = new.bucket
       and o.name = new.storage_path
  ) then
    raise exception 'El archivo de evidencia no existe en Storage';
  end if;

  -- Los metadatos son autoritativos: nunca se aceptan del cliente.
  new.turno_id    := v_turno_id;
  new.guardia_id  := v_guardia_id;
  new.objetivo_id := v_objetivo_id;

  return new;
end;
$$;

revoke all on function public.rondas_validar_evidencia_punto() from public;
revoke all on function public.rondas_validar_evidencia_punto() from anon;
revoke all on function public.rondas_validar_evidencia_punto() from authenticated;

drop trigger if exists trg_rondas_validar_evidencia_punto on public.evidencias;
create trigger trg_rondas_validar_evidencia_punto
  before insert or update on public.evidencias
  for each row execute function public.rondas_validar_evidencia_punto();

-- ── Distancia Haversine sin PostGIS ─────────────────────────────────────────

create or replace function public.rondas_distancia_metros(
  p_latitud_1  double precision,
  p_longitud_1 double precision,
  p_latitud_2  double precision,
  p_longitud_2 double precision
)
returns double precision
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  with valores as (
    select
      radians(p_latitud_2 - p_latitud_1)  as dlat,
      radians(p_longitud_2 - p_longitud_1) as dlng,
      radians(p_latitud_1)                 as lat1,
      radians(p_latitud_2)                 as lat2
  ),
  haversine as (
    select
      power(sin(dlat / 2), 2)
      + cos(lat1) * cos(lat2) * power(sin(dlng / 2), 2) as a
    from valores
  )
  select
    2 * 6371000.0
    * atan2(
        sqrt(least(1.0, greatest(0.0, a))),
        sqrt(least(1.0, greatest(0.0, 1.0 - a)))
      )
  from haversine;
$$;

revoke all on function public.rondas_distancia_metros(
  double precision, double precision, double precision, double precision
) from public;
revoke all on function public.rondas_distancia_metros(
  double precision, double precision, double precision, double precision
) from anon;
revoke all on function public.rondas_distancia_metros(
  double precision, double precision, double precision, double precision
) from authenticated;

-- ── RPC: resolver el punto actual ────────────────────────────────────────────

create or replace function public.registrar_punto_ronda(
  p_ejecucion_punto_id uuid,
  p_latitud            double precision default null,
  p_longitud           double precision default null,
  p_precision_metros   double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  v_ctx                  record;
  v_ejecucion_id         uuid;
  v_ejecucion_estado     text;
  v_punto_estado         text;
  v_punto_orden          integer;
  v_snap_latitud         double precision;
  v_snap_longitud        double precision;
  v_snap_radio_metros    integer;
  v_foto_requerida       boolean;
  v_gps_requerido        boolean;
  v_primero_pendiente_id uuid;
  v_tiene_gps            boolean;
  v_gps_ok               boolean;
  v_dentro_radio         boolean;
  v_foto_ok              boolean;
  v_distancia_metros     double precision;
  v_estado_nuevo         text := 'cumplido';
  v_pendientes           integer;
  v_todos_cumplidos      boolean;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida';
  end if;

  if p_ejecucion_punto_id is null then
    return jsonb_build_object(
      'contexto', 'punto_no_disponible',
      'punto', null,
      'ejecucion', null
    );
  end if;

  select * into v_ctx from public.rondas_turno_vigente();
  if v_ctx.turno_id is null then
    return jsonb_build_object(
      'contexto', 'sin_turno_vigente',
      'punto', null,
      'ejecucion', null
    );
  end if;

  -- Bloquea ejecución y punto para serializar doble toque y llamadas paralelas.
  select
    e.id,
    e.estado,
    ep.estado,
    ep.orden,
    ep.snap_latitud,
    ep.snap_longitud,
    ep.snap_radio_metros,
    ep.snap_foto_requerida,
    ep.snap_gps_requerido
  into
    v_ejecucion_id,
    v_ejecucion_estado,
    v_punto_estado,
    v_punto_orden,
    v_snap_latitud,
    v_snap_longitud,
    v_snap_radio_metros,
    v_foto_requerida,
    v_gps_requerido
  from public.ronda_ejecucion_puntos ep
  join public.ronda_ejecuciones e on e.id = ep.ronda_ejecucion_id
  where ep.id          = p_ejecucion_punto_id
    and e.turno_id     = v_ctx.turno_id
    and e.guardia_id   = v_ctx.usuario_id
  for update of e, ep;

  if v_ejecucion_id is null then
    return jsonb_build_object(
      'contexto', 'punto_no_disponible',
      'punto', null,
      'ejecucion', null
    );
  end if;

  -- Reintento luego de una respuesta perdida: no vuelve a escribir.
  if v_punto_estado <> 'pendiente' then
    return jsonb_build_object(
      'contexto', 'ya_registrado',
      'punto', jsonb_build_object(
        'ejecucion_punto_id', p_ejecucion_punto_id,
        'estado', v_punto_estado
      ),
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  if v_ejecucion_estado <> 'en_curso' then
    return jsonb_build_object(
      'contexto', 'ejecucion_cerrada',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  select ep.id
    into v_primero_pendiente_id
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = v_ejecucion_id
     and ep.estado = 'pendiente'
   order by ep.orden
   limit 1;

  if v_primero_pendiente_id is distinct from p_ejecucion_punto_id then
    return jsonb_build_object(
      'contexto', 'fuera_de_secuencia',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- Coordenadas completas o ninguna.
  if (p_latitud is null) <> (p_longitud is null)
     or (p_latitud is not null and (p_latitud < -90 or p_latitud > 90))
     or (p_longitud is not null and (p_longitud < -180 or p_longitud > 180))
     or (p_precision_metros is not null and p_precision_metros < 0)
     or (p_precision_metros is not null and p_latitud is null) then
    return jsonb_build_object(
      'contexto', 'gps_invalido',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- La foto obligatoria es bloqueante. No alcanza una fila declarativa: debe
  -- existir la evidencia y el objeto privado que la respalda.
  if v_foto_requerida then
    select exists (
      select 1
        from public.evidencias ev
        join storage.objects so
          on so.bucket_id = ev.bucket
         and so.name      = ev.storage_path
       where ev.proceso_tipo   = 'ronda'
         and ev.proceso_id     = p_ejecucion_punto_id
         and ev.tipo_evidencia = 'punto_control'
         and ev.bucket         = 'ronda-evidencias'
    ) into v_foto_ok;

    if not v_foto_ok then
      return jsonb_build_object(
        'contexto', 'foto_pendiente',
        'punto', null,
        'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
      );
    end if;
  else
    v_foto_ok := null;
  end if;

  v_tiene_gps := p_latitud is not null;
  v_gps_ok    := case when v_gps_requerido then v_tiene_gps else null end;

  if v_tiene_gps
     and v_snap_latitud is not null
     and v_snap_longitud is not null then
    v_distancia_metros := public.rondas_distancia_metros(
      p_latitud,
      p_longitud,
      v_snap_latitud,
      v_snap_longitud
    );

    if v_snap_radio_metros is not null then
      v_dentro_radio := v_distancia_metros <= v_snap_radio_metros;
    end if;
  end if;

  -- Sólo las exigencias configuradas afectan el veredicto.
  if v_gps_requerido and not v_tiene_gps then
    v_estado_nuevo := 'incumplido';
  elsif v_gps_requerido and v_dentro_radio is false then
    v_estado_nuevo := 'incumplido';
  end if;

  update public.ronda_ejecucion_puntos
     set registrado_at    = now(),
         latitud          = p_latitud,
         longitud         = p_longitud,
         precision_metros = p_precision_metros,
         distancia_metros = v_distancia_metros,
         gps_ok            = v_gps_ok,
         dentro_radio      = v_dentro_radio,
         foto_ok           = v_foto_ok,
         estado            = v_estado_nuevo
   where id = p_ejecucion_punto_id
     and estado = 'pendiente';

  select count(*)
    into v_pendientes
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = v_ejecucion_id
     and ep.estado = 'pendiente';

  if v_pendientes = 0 then
    select bool_and(ep.estado = 'cumplido')
      into v_todos_cumplidos
      from public.ronda_ejecucion_puntos ep
     where ep.ronda_ejecucion_id = v_ejecucion_id;

    update public.ronda_ejecuciones
       set estado        = 'finalizada',
           resultado     = case when v_todos_cumplidos then 'completa' else 'incompleta' end,
           finalizada_at = now()
     where id = v_ejecucion_id
       and estado = 'en_curso';
  end if;

  return jsonb_build_object(
    'contexto', 'registrado',
    'punto', jsonb_build_object(
      'ejecucion_punto_id', p_ejecucion_punto_id,
      'orden',              v_punto_orden,
      'estado',             v_estado_nuevo,
      'gps_ok',             v_gps_ok,
      'dentro_radio',       v_dentro_radio,
      'foto_ok',            v_foto_ok,
      'distancia_metros',   v_distancia_metros
    ),
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

revoke all on function public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision
) from public;
revoke all on function public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision
) from anon;
grant execute on function public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision
) to authenticated;

notify pgrst, 'reload schema';

commit;
