/*
================================================================================
ROLLBACK — Correctivo Rondas C1/C4
================================================================================

Revierte exclusivamente:
  supabase/migrations/20260728234500_rondas_correctivo_c1_c4.sql

Restaura las definiciones inmediatamente anteriores de iniciar_ronda y
registrar_punto_ronda, tomadas respectivamente de:
  * 20260728200000_rondas_ejecucion_base.sql
  * 20260728223000_rondas_app_vigilador_backend.sql

CREATE OR REPLACE conserva el ownership existente. Las funciones previas no
tenían COMMENT ON FUNCTION, por lo que no existe un comentario que reemplazar.
No elimina ni modifica datos, tablas, evidencias, buckets o migraciones previas.
================================================================================
*/

begin;

alter table public.ronda_ejecucion_puntos
  drop constraint if exists ronda_ejecucion_puntos_snap_gps_config_completa;

alter table public.ronda_puntos
  drop constraint if exists ronda_puntos_gps_config_completa;

-- Definición exacta previa: 20260728200000_rondas_ejecucion_base.sql.
create or replace function public.iniciar_ronda(p_ronda_base_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ctx            record;
  v_ronda          record;
  v_turno          record;
  v_ejecucion_id   uuid;
  v_inicio_previsto timestamp;
  v_fuera          boolean := false;
  v_total          integer;
  v_insertados     integer;
  v_constraint     text;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select * into v_ctx from public.rondas_turno_vigente();
  if v_ctx.turno_id is null then
    return jsonb_build_object('contexto', 'sin_turno_vigente', 'ejecucion', null);
  end if;
  if v_ctx.puesto_id is null then
    return jsonb_build_object('contexto', 'turno_sin_puesto', 'ejecucion', null);
  end if;

  -- Idempotencia por lectura: si ya hay una ejecución abierta de ESTE guardia en
  -- ESTE turno, se devuelve. Nunca se toca la de otro guardia (reemplazo).
  select e.id into v_ejecucion_id
    from public.ronda_ejecuciones e
   where e.turno_id  = v_ctx.turno_id
     and e.guardia_id = v_ctx.usuario_id
     and e.estado    = 'en_curso'
   limit 1;

  if v_ejecucion_id is not null then
    return jsonb_build_object(
      'contexto',  'recuperada',
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  -- La ronda debe existir, estar activa y pertenecer al puesto del turno vigente.
  -- Es la única validación sobre un identificador recibido del cliente.
  --
  -- `for update` no es decorativo: todo alta, edición o reordenamiento de puntos
  -- dispara touch_ronda_base_desde_punto(), que actualiza esta misma fila. Tomar
  -- el lock serializa el inicio contra una edición concurrente de los puntos y
  -- garantiza que el conteo y el snapshot vean el mismo conjunto.
  select rb.* into v_ronda
    from public.rondas_base rb
   where rb.id = p_ronda_base_id
     and rb.activo = true
     and rb.puesto_id = v_ctx.puesto_id
     for update;

  if not found then
    return jsonb_build_object('contexto', 'ronda_no_disponible', 'ejecucion', null);
  end if;

  select count(*) into v_total
    from public.ronda_puntos rp
   where rp.ronda_base_id = v_ronda.id
     and rp.activo = true;

  if v_total = 0 then
    return jsonb_build_object('contexto', 'ronda_sin_puntos', 'ejecucion', null);
  end if;

  -- Marca de inicio fuera de horario, anclada al turno y no al reloj del día.
  -- Un turno 22:00-06:00 con ronda a las 02:00: ese instante pertenece al día
  -- siguiente de la fecha operativa, y así se calcula.
  if v_ronda.hora_inicio is not null then
    select t.hora_inicio into v_turno from public.turnos t where t.id = v_ctx.turno_id;
    v_inicio_previsto := v_ctx.fecha_operativa + v_ronda.hora_inicio;
    if v_inicio_previsto < (v_ctx.fecha_operativa + v_turno.hora_inicio) then
      v_inicio_previsto := v_inicio_previsto + interval '1 day';
    end if;
    v_fuera := v_ctx.ahora_local < v_inicio_previsto;
  end if;

  begin
    insert into public.ronda_ejecuciones (
      ronda_base_id, turno_id, guardia_id, objetivo_id, puesto_id,
      fecha_operativa, estado, iniciada_fuera_horario, puntos_total,
      snap_ronda_nombre, snap_intervalo_minutos, snap_hora_inicio
    ) values (
      v_ronda.id, v_ctx.turno_id, v_ctx.usuario_id, v_ctx.objetivo_id, v_ctx.puesto_id,
      v_ctx.fecha_operativa, 'en_curso', v_fuera, v_total,
      v_ronda.nombre, v_ronda.intervalo_minutos, v_ronda.hora_inicio
    )
    returning id into v_ejecucion_id;
  exception when unique_violation then
    -- Dos toques concurrentes: el índice parcial rechaza el segundo. Se relee y
    -- se devuelve la que ganó, en lugar de propagar el error.
    --
    -- Sólo se absorbe LA violación esperada. Cualquier otra restricción única
    -- que exista hoy o se agregue mañana se vuelve a lanzar: un catch amplio
    -- convertiría un defecto nuevo en un "recuperada" silencioso.
    get stacked diagnostics v_constraint = constraint_name;

    if v_constraint is distinct from 'ronda_ejecuciones_turno_guardia_en_curso_unique' then
      raise;
    end if;

    select e.id into v_ejecucion_id
      from public.ronda_ejecuciones e
     where e.turno_id  = v_ctx.turno_id
       and e.guardia_id = v_ctx.usuario_id
       and e.estado    = 'en_curso'
     limit 1;

    -- Si la ejecución en conflicto se cerró entre la violación y esta relectura,
    -- no hay nada que recuperar. Devolver 'recuperada' con ejecucion null sería
    -- mentir; se propaga el error original y el cliente reintenta.
    if v_ejecucion_id is null then
      raise;
    end if;

    return jsonb_build_object(
      'contexto',  'recuperada',
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end;

  -- Snapshot de los puntos ACTIVOS al momento de iniciar. Se pre-crean todos:
  -- así 'pendiente' es un estado real, el registro posterior es siempre UPDATE
  -- (idempotente) y la ejecución no cambia si después se edita la ronda.
  insert into public.ronda_ejecucion_puntos (
    ronda_ejecucion_id, ronda_punto_id, orden, snap_nombre,
    snap_latitud, snap_longitud, snap_radio_metros,
    snap_foto_requerida, snap_gps_requerido
  )
  select
    v_ejecucion_id, rp.id,
    row_number() over (order by rp.orden, rp.id),
    rp.nombre, rp.latitud, rp.longitud, rp.radio_metros,
    rp.foto_requerida, rp.gps_requerido
  from public.ronda_puntos rp
  where rp.ronda_base_id = v_ronda.id
    and rp.activo = true;

  get diagnostics v_insertados = row_count;

  -- Red de seguridad sobre el lock: si por cualquier motivo el conjunto de
  -- puntos cambió entre el conteo y el snapshot, manda lo efectivamente
  -- guardado. `puntos_total` es el denominador del porcentaje y no puede
  -- discrepar de las filas existentes.
  if v_insertados <> v_total then
    update public.ronda_ejecuciones
       set puntos_total = v_insertados
     where id = v_ejecucion_id;
  end if;

  return jsonb_build_object(
    'contexto',  'iniciada',
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

revoke all on function public.iniciar_ronda(uuid) from public;
revoke all on function public.iniciar_ronda(uuid) from anon;
grant execute on function public.iniciar_ronda(uuid) to authenticated;

-- Definición exacta previa: 20260728223000_rondas_app_vigilador_backend.sql.
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
