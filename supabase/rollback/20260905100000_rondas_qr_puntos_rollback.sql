-- ============================================================================
-- ROLLBACK · 20260905100000_rondas_qr_puntos
-- ============================================================================
--
-- Deshace la validación física por QR:
--   * elimina las RPC nuevas (validar/generar/obtener QR);
--   * restaura iniciar_ronda, rondas_ejecucion_json y registrar_punto_ronda
--     EXACTAMENTE como estaban vivas en producción antes del QR (versión
--     20260729120000_ronda_puntos_politica_foto.sql — cotejada byte a byte
--     contra producción el 07/09/2026; snapshot en poder del operador);
--   * restaura rondas_ejecucion_detalle_supervisor como en 20260730120000;
--   * restaura ronda_puntos_auditar_cambio como en 20260813100000;
--   * elimina las columnas QR de ronda_ejecucion_puntos (los datos de
--     verificaciones ya realizadas SE PIERDEN);
--   * elimina la tabla ronda_punto_qr (las credenciales emitidas SE PIERDEN:
--     los carteles impresos dejan de validar);
--   * elimina ronda_puntos.qr_modo.
--
-- NOTA: la migración 20260802100000 (control GPS por reincidencia) NO está
-- aplicada en producción; por eso las versiones restauradas acá NO la incluyen.
--
-- Las filas de ronda_puntos_auditoria con campo 'qr_credencial' / 'qr_modo' se
-- conservan: la auditoría no se borra.
-- ============================================================================

begin;

-- ── 1. RPC nuevas ───────────────────────────────────────────────────────────

drop function if exists public.validar_qr_ronda_punto(
  uuid, text, double precision, double precision, double precision
);
drop function if exists public.generar_qr_ronda_punto(uuid, boolean);
drop function if exists public.obtener_qr_ronda_punto(uuid);

-- ── 2. iniciar_ronda: versión viva pre-QR (20260729120000) ──────────────────

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

  -- Idempotencia por lectura: si ya hay una ejecución abierta de ESTE guardia en
  -- ESTE turno, se devuelve. Nunca se toca la de otro guardia (reemplazo).
  -- La respuesta siempre usa el serializador contractual completo y esta rama
  -- no toma locks ni modifica la ejecución.
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

    -- La ejecución que ganó la carrera puede pertenecer a la misma ronda o a
    -- otra. Igual que en la lectura inicial, esta rama sólo observa y devuelve.
    -- Esta relectura depende del aislamiento normal de PostgREST/Supabase:
    -- READ COMMITTED permite ver la fila confirmada por la transacción ganadora.
    select e.id, e.ronda_base_id
      into v_ejecucion_id, v_ejecucion_ronda_base_id
      from public.ronda_ejecuciones e
     where e.turno_id  = v_ctx.turno_id
       and e.guardia_id = v_ctx.usuario_id
       and e.estado    = 'en_curso'
     limit 1;

    -- Si la ejecución en conflicto se cerró entre la violación y esta relectura,
    -- no hay nada que recuperar. Devolver un contexto con ejecución null sería
    -- mentir; se propaga el error original y el cliente reintenta.
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

  -- Snapshot de los puntos ACTIVOS al momento de iniciar. Se pre-crean todos:
  -- así 'pendiente' es un estado real, el registro posterior es siempre UPDATE
  -- (idempotente) y la ejecución no cambia si después se edita la ronda.
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

-- ── 3. rondas_ejecucion_json: versión viva pre-QR (20260729120000) ──────────

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

-- ── 4. registrar_punto_ronda: versión viva pre-QR (20260729120000) ──────────

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

  -- Bloquea ejecución y punto para serializar doble toque y llamadas paralelas.
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

  -- Una configuración histórica inválida nunca se interpreta como cumplimiento
  -- ni se consume: se devuelve un contexto estable y no se modifica el punto.
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

  -- La política del SNAPSHOT decide, no la configuración actual del punto: una
  -- edición posterior no cambia las reglas de esta ejecución.
  v_foto_obligatoria := (v_politica_foto = 'obligatoria')
                        or (v_politica_foto = 'solo_novedad' and v_novedad);

  -- La foto se busca siempre: con política `opcional` el vigilador puede
  -- haberla sacado igual, y esa evidencia se registra como cumplida.
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

  -- null = no correspondía exigirla y no se sacó. Mismo criterio que gps_ok.
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

  -- Para GPS obligatorio sólo `dentro_radio = true` permite cumplimiento.
  -- La novedad no degrada el veredicto: es información, no un incumplimiento.
  -- precision_metros conserva su contrato actual: se valida y almacena, pero no
  -- participa del veredicto.
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

-- ── 5. rondas_ejecucion_detalle_supervisor: versión viva pre-QR (20260730120000)

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
  -- 1. Sesión.
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  -- 2. Localizar la ejecución solo para conocer su objetivo y poder autorizar.
  --    Nada de la ejecución se expone antes de pasar el control de acceso.
  select e.objetivo_id, e.puntos_total
    into v_objetivo_id, v_total
  from public.ronda_ejecuciones e
  where e.id = p_ejecucion_id;

  if not found then
    return jsonb_build_object('contexto', 'no_encontrada');
  end if;

  -- 3. Autorización: admin, o supervisor con la zona del objetivo asignada.
  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  -- 4. Progreso (puntos resueltos sobre el total congelado en la ejecución).
  select count(*)
    into v_completados
  from public.ronda_ejecucion_puntos ep
  where ep.ronda_ejecucion_id = p_ejecucion_id
    and ep.estado <> 'pendiente';

  -- 5. Cabecera de la ejecución (guardia, puesto, ronda, cierre administrativo).
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
    -- Cierre administrativo: cerrada_por IS NOT NULL lo distingue de una ronda
    -- que el vigilador terminó con puntos incumplidos (mismo estado/resultado).
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

  -- 6. Puntos: definición congelada (snap_*), GPS real capturado, veredictos,
  --    novedad/comentario y referencias de evidencia (sin firmar).
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
        -- Reglas congeladas al iniciar la ronda.
        'requiere_foto',       ep.snap_foto_requerida,
        'politica_foto',       ep.snap_politica_foto,
        'requiere_gps',        ep.snap_gps_requerido,
        'config_latitud',      ep.snap_latitud,
        'config_longitud',     ep.snap_longitud,
        'config_radio_metros', ep.snap_radio_metros,
        -- GPS real capturado por el vigilador.
        'latitud',             ep.latitud,
        'longitud',            ep.longitud,
        'precision_metros',    ep.precision_metros,
        'distancia_metros',    ep.distancia_metros,
        'gps_ok',              ep.gps_ok,
        'dentro_radio',        ep.dentro_radio,
        'foto_ok',             ep.foto_ok,
        -- Referencias de evidencia (proceso_id = id del punto de ejecución).
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

-- ── 6. ronda_puntos_auditar_cambio: versión de 20260813100000 ───────────────

create or replace function public.ronda_puntos_auditar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_origen  text;
  v_firma   text;
  v_usuario uuid;
begin
  v_origen := nullif(btrim(coalesce(new.ctx_cambio_origen, '')), '');
  v_firma  := nullif(btrim(coalesce(new.ctx_cambio_firma,  '')), '');

  new.ctx_cambio_origen := null;
  new.ctx_cambio_firma  := null;

  v_origen := coalesce(v_origen, 'manual');

  if v_origen not in ('manual', 'diagnostico_gps') then
    raise exception
      'ronda_punto_ctx_origen_invalido: origen de cambio no reconocido (%)', v_origen
      using errcode = 'check_violation';
  end if;

  if v_origen = 'manual' then
    if v_firma is not null then
      raise exception
        'ronda_punto_ctx_firma_sin_origen: una modificacion manual no lleva firma'
        using errcode = 'check_violation';
    end if;
  elsif v_firma is null then
    raise exception
      'ronda_punto_ctx_firma_faltante: el origen % exige firma del diagnostico', v_origen
      using errcode = 'check_violation';
  elsif length(v_firma) > 120 then
    raise exception
      'ronda_punto_ctx_firma_invalida: firma fuera de formato'
      using errcode = 'check_violation';
  end if;

  if new.radio_metros   is not distinct from old.radio_metros
     and new.latitud    is not distinct from old.latitud
     and new.longitud   is not distinct from old.longitud
     and new.gps_requerido is not distinct from old.gps_requerido then
    return new;
  end if;

  v_usuario := public.rondas_usuario_actual_id();

  insert into public.ronda_puntos_auditoria (
    ronda_punto_id, ronda_base_id, campo, valor_anterior, valor_nuevo,
    origen, firma, modificado_por
  )
  select
    new.id, new.ronda_base_id, c.campo, c.anterior, c.nuevo,
    v_origen, v_firma, v_usuario
  from (values
    ('radio_metros',  old.radio_metros::text,   new.radio_metros::text),
    ('latitud',       old.latitud::text,        new.latitud::text),
    ('longitud',      old.longitud::text,       new.longitud::text),
    ('gps_requerido', old.gps_requerido::text,  new.gps_requerido::text)
  ) as c(campo, anterior, nuevo)
  where c.anterior is distinct from c.nuevo;

  return new;
end;
$$;

revoke all on function public.ronda_puntos_auditar_cambio() from public;
revoke all on function public.ronda_puntos_auditar_cambio() from anon;
revoke all on function public.ronda_puntos_auditar_cambio() from authenticated;

-- ── 7. Columnas y tabla ─────────────────────────────────────────────────────
-- Los constraints e índices que involucran estas columnas caen con ellas.

alter table public.ronda_ejecucion_puntos
  drop column if exists snap_qr_modo,
  drop column if exists qr_verificado_at,
  drop column if exists qr_credencial_id,
  drop column if exists qr_latitud,
  drop column if exists qr_longitud,
  drop column if exists qr_precision_metros,
  drop column if exists qr_distancia_metros,
  drop column if exists qr_intentos_invalidos;

drop table if exists public.ronda_punto_qr;

alter table public.ronda_puntos
  drop column if exists qr_modo;

notify pgrst, 'reload schema';

commit;
