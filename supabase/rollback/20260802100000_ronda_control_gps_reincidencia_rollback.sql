-- ============================================================================
-- ROLLBACK de 20260802100000_ronda_control_gps_reincidencia
-- ============================================================================
--
-- Restituye:
--   · iniciar_ronda, registrar_punto_ronda y rondas_ejecucion_json exactamente
--     como las dejó 20260729120000_ronda_puntos_politica_foto.sql;
--   · rondas_ejecucion_detalle_supervisor exactamente como la dejó
--     20260730120000_rondas_ejecucion_detalle_supervisor.sql;
--   · elimina la columna snap_foto_control_gps y la tabla
--     ronda_punto_control_gps.
--
-- ORDEN OBLIGATORIO: primero las funciones (dejan de referenciar la columna),
-- después la columna, después la tabla.
--
-- CONSECUENCIA CONOCIDA: se pierden las rachas acumuladas. Si esta migración
-- se vuelve a aplicar después, todos los contadores arrancan de cero — el
-- comportamiento es el de un sistema recién instalado, no hay estado
-- inconsistente posible.

begin;

-- ── 1. iniciar_ronda (versión 20260729120000) ───────────────────────────────

create or replace function public.iniciar_ronda(p_ronda_base_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ctx                     record;
  v_ronda                   record;
  v_turno                   record;
  v_ejecucion_id            uuid;
  v_ejecucion_ronda_base_id uuid;
  v_inicio_previsto         timestamp;
  v_fuera                   boolean := false;
  v_total                   integer;
  v_insertados              integer;
  v_constraint              text;
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

  select e.id, e.ronda_base_id
    into v_ejecucion_id, v_ejecucion_ronda_base_id
    from public.ronda_ejecuciones e
   where e.turno_id  = v_ctx.turno_id
     and e.guardia_id = v_ctx.usuario_id
     and e.estado    = 'en_curso'
   limit 1;

  if v_ejecucion_id is not null then
    return jsonb_build_object(
      'contexto',
        case
          when v_ejecucion_ronda_base_id = p_ronda_base_id then 'recuperada'
          else 'otra_ronda_en_curso'
        end,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

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
    get stacked diagnostics v_constraint = constraint_name;

    if v_constraint is distinct from 'ronda_ejecuciones_turno_guardia_en_curso_unique' then
      raise;
    end if;

    select e.id, e.ronda_base_id
      into v_ejecucion_id, v_ejecucion_ronda_base_id
      from public.ronda_ejecuciones e
     where e.turno_id  = v_ctx.turno_id
       and e.guardia_id = v_ctx.usuario_id
       and e.estado    = 'en_curso'
     limit 1;

    if v_ejecucion_id is null then
      raise;
    end if;

    return jsonb_build_object(
      'contexto',
        case
          when v_ejecucion_ronda_base_id = p_ronda_base_id then 'recuperada'
          else 'otra_ronda_en_curso'
        end,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end;

  insert into public.ronda_ejecucion_puntos (
    ronda_ejecucion_id, ronda_punto_id, orden, snap_nombre,
    snap_latitud, snap_longitud, snap_radio_metros,
    snap_foto_requerida, snap_gps_requerido, snap_politica_foto
  )
  select
    v_ejecucion_id, rp.id,
    row_number() over (order by rp.orden, rp.id),
    rp.nombre, rp.latitud, rp.longitud, rp.radio_metros,
    rp.foto_requerida, rp.gps_requerido, rp.politica_foto
  from public.ronda_puntos rp
  where rp.ronda_base_id = v_ronda.id
    and rp.activo = true;

  get diagnostics v_insertados = row_count;

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

-- ── 2. rondas_ejecucion_json (versión 20260729120000) ───────────────────────

create or replace function public.rondas_ejecucion_json(p_ejecucion_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'id',                 e.id,
    'estado',             e.estado,
    'hora_inicio',        e.iniciada_at,
    'hora_fin',           e.finalizada_at,
    'porcentaje',         case when e.puntos_total = 0 then 0
                            else round((count(*) filter (where p.estado <> 'pendiente')) * 100.0 / e.puntos_total)
                          end,
    'puntos_completados', count(*) filter (where p.estado <> 'pendiente'),
    'puntos_total',       e.puntos_total,
    'punto_actual_id',    (select p2.ronda_punto_id
                             from public.ronda_ejecucion_puntos p2
                            where p2.ronda_ejecucion_id = e.id
                              and p2.estado = 'pendiente'
                            order by p2.orden limit 1),
    'puede_continuar',    e.estado = 'en_curso',
    'resultado',          e.resultado,
    'ronda_base_id',      e.ronda_base_id,
    'ronda_nombre',       e.snap_ronda_nombre,
    'fecha_operativa',    e.fecha_operativa,
    'fuera_horario',      e.iniciada_fuera_horario,
    'puntos', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ronda_punto_id',    p.ronda_punto_id,
          'ejecucion_punto_id', p.id,
          'orden',             p.orden,
          'nombre',            p.snap_nombre,
          'estado',            p.estado,
          'completado_at',     p.registrado_at,
          'requiere_foto',     p.snap_foto_requerida,
          'politica_foto',     p.snap_politica_foto,
          'hay_novedad',       p.hay_novedad,
          'requiere_gps',      p.snap_gps_requerido,
          'latitud',           p.snap_latitud,
          'longitud',          p.snap_longitud,
          'radio_metros',      p.snap_radio_metros
        ) order by p.orden
      ) filter (where p.id is not null),
      jsonb_build_array()
    )
  )
  from public.ronda_ejecuciones e
  left join public.ronda_ejecucion_puntos p on p.ronda_ejecucion_id = e.id
  where e.id = p_ejecucion_id
  group by e.id;
$$;

revoke all on function public.rondas_ejecucion_json(uuid) from public;
revoke all on function public.rondas_ejecucion_json(uuid) from anon;

-- ── 3. registrar_punto_ronda (versión 20260729120000) ───────────────────────

create or replace function public.registrar_punto_ronda(
  p_ejecucion_punto_id uuid,
  p_latitud            double precision default null,
  p_longitud           double precision default null,
  p_precision_metros   double precision default null,
  p_hay_novedad        boolean default false
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
  v_politica_foto        text;
  v_gps_requerido        boolean;
  v_primero_pendiente_id uuid;
  v_novedad              boolean := coalesce(p_hay_novedad, false);
  v_foto_obligatoria     boolean;
  v_foto_presente        boolean;
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

  select
    e.id,
    e.estado,
    ep.estado,
    ep.orden,
    ep.snap_latitud,
    ep.snap_longitud,
    ep.snap_radio_metros,
    ep.snap_politica_foto,
    ep.snap_gps_requerido
  into
    v_ejecucion_id,
    v_ejecucion_estado,
    v_punto_estado,
    v_punto_orden,
    v_snap_latitud,
    v_snap_longitud,
    v_snap_radio_metros,
    v_politica_foto,
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

  if v_gps_requerido
     and (
       v_snap_latitud is null
       or v_snap_longitud is null
       or v_snap_radio_metros is null
     ) then
    return jsonb_build_object(
      'contexto', 'configuracion_gps_invalida',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  v_foto_obligatoria := (v_politica_foto = 'obligatoria')
                        or (v_politica_foto = 'solo_novedad' and v_novedad);

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
  ) into v_foto_presente;

  if v_foto_obligatoria and not v_foto_presente then
    return jsonb_build_object(
      'contexto', 'foto_pendiente',
      'punto', null,
      'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
    );
  end if;

  v_foto_ok := case when v_foto_presente then true else null end;

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

  if v_gps_requerido
     and (
       not v_tiene_gps
       or v_dentro_radio is distinct from true
     ) then
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
         hay_novedad       = v_novedad,
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
      'hay_novedad',        v_novedad,
      'politica_foto',      v_politica_foto,
      'distancia_metros',   v_distancia_metros
    ),
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

revoke all on function public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision, boolean
) from public;
revoke all on function public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision, boolean
) from anon;
grant execute on function public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision, boolean
) to authenticated;

-- ── 4. rondas_ejecucion_detalle_supervisor (versión 20260730120000) ─────────

create or replace function public.rondas_ejecucion_detalle_supervisor(p_ejecucion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_objetivo_id uuid;
  v_total       integer;
  v_completados integer;
  v_ejecucion   jsonb;
  v_puntos      jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select e.objetivo_id, e.puntos_total
    into v_objetivo_id, v_total
  from public.ronda_ejecuciones e
  where e.id = p_ejecucion_id;

  if not found then
    return jsonb_build_object('contexto', 'no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  select count(*)
    into v_completados
  from public.ronda_ejecucion_puntos ep
  where ep.ronda_ejecucion_id = p_ejecucion_id
    and ep.estado <> 'pendiente';

  select jsonb_build_object(
    'id',                      e.id,
    'estado',                  e.estado,
    'resultado',               e.resultado,
    'iniciada_at',             e.iniciada_at,
    'finalizada_at',           e.finalizada_at,
    'fecha_operativa',         e.fecha_operativa,
    'iniciada_fuera_horario',  e.iniciada_fuera_horario,
    'puntos_total',            e.puntos_total,
    'puntos_completados',      v_completados,
    'porcentaje',              case when e.puntos_total = 0 then 0
                                    else round(v_completados * 100.0 / e.puntos_total)
                               end,
    'ronda_base_id',           e.ronda_base_id,
    'ronda_nombre',            e.snap_ronda_nombre,
    'snap_intervalo_minutos',  e.snap_intervalo_minutos,
    'snap_hora_inicio',        e.snap_hora_inicio,
    'objetivo_id',             e.objetivo_id,
    'objetivo_nombre',         o.nombre,
    'puesto_id',               e.puesto_id,
    'puesto_nombre',           pu.nombre,
    'guardia_id',              e.guardia_id,
    'guardia_nombre',          g.apellido || ', ' || g.nombre,
    'cerrada_por',             e.cerrada_por,
    'cerrada_por_nombre',      case when e.cerrada_por is null then null
                                    else cp.apellido || ', ' || cp.nombre end,
    'cerrada_at',              e.cerrada_at,
    'cerrada_motivo',          e.cerrada_motivo,
    'es_cierre_administrativo',(e.cerrada_por is not null)
  )
  into v_ejecucion
  from public.ronda_ejecuciones e
  join public.objetivos o  on o.id  = e.objetivo_id
  join public.puestos   pu on pu.id = e.puesto_id
  join public.usuarios  g  on g.id  = e.guardia_id
  left join public.usuarios cp on cp.id = e.cerrada_por
  where e.id = p_ejecucion_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ejecucion_punto_id',  ep.id,
        'ronda_punto_id',      ep.ronda_punto_id,
        'orden',               ep.orden,
        'nombre',              ep.snap_nombre,
        'estado',              ep.estado,
        'registrado_at',       ep.registrado_at,
        'comentario',          ep.comentario,
        'hay_novedad',         ep.hay_novedad,
        'requiere_foto',       ep.snap_foto_requerida,
        'politica_foto',       ep.snap_politica_foto,
        'requiere_gps',        ep.snap_gps_requerido,
        'config_latitud',      ep.snap_latitud,
        'config_longitud',     ep.snap_longitud,
        'config_radio_metros', ep.snap_radio_metros,
        'latitud',             ep.latitud,
        'longitud',            ep.longitud,
        'precision_metros',    ep.precision_metros,
        'distancia_metros',    ep.distancia_metros,
        'gps_ok',              ep.gps_ok,
        'dentro_radio',        ep.dentro_radio,
        'foto_ok',             ep.foto_ok,
        'evidencias',          coalesce(ev.evidencias, jsonb_build_array())
      )
      order by ep.orden
    ),
    jsonb_build_array()
  )
  into v_puntos
  from public.ronda_ejecucion_puntos ep
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'id',             x.id,
               'tipo_evidencia', x.tipo_evidencia,
               'bucket',         x.bucket,
               'storage_path',   x.storage_path,
               'created_at',     x.created_at
             )
             order by x.created_at
           ) as evidencias
    from public.evidencias x
    where x.proceso_tipo = 'ronda'
      and x.proceso_id   = ep.id
  ) ev on true
  where ep.ronda_ejecucion_id = p_ejecucion_id;

  return jsonb_build_object(
    'contexto',  'ok',
    'ejecucion', v_ejecucion,
    'puntos',    v_puntos
  );
end;
$$;

revoke all on function public.rondas_ejecucion_detalle_supervisor(uuid) from public;
revoke all on function public.rondas_ejecucion_detalle_supervisor(uuid) from anon;
grant execute on function public.rondas_ejecucion_detalle_supervisor(uuid) to authenticated;

-- ── 5. Columna y tabla, en ese orden ────────────────────────────────────────

alter table public.ronda_ejecucion_puntos
  drop column if exists snap_foto_control_gps;

drop table if exists public.ronda_punto_control_gps;

notify pgrst, 'reload schema';

commit;
