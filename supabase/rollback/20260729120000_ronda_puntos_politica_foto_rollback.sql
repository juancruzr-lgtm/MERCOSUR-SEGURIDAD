/*
================================================================================
ROLLBACK — Política de foto por punto
================================================================================

Revierte: supabase/migrations/20260729120000_ronda_puntos_politica_foto.sql

Restaura las definiciones inmediatamente anteriores de iniciar_ronda,
rondas_ejecucion_json y registrar_punto_ronda, tomadas respectivamente de:
  * 20260728234500_rondas_correctivo_c1_c4.sql  (iniciar_ronda, registrar_punto)
  * 20260728200000_rondas_ejecucion_base.sql    (rondas_ejecucion_json)

--------------------------------------------------------------------------------
QUÉ SE PIERDE
--------------------------------------------------------------------------------
  * `politica_foto`: los puntos con `solo_novedad` u `opcional` colapsan al
    booleano `foto_requerida`, que el trigger ya venía manteniendo. Un punto en
    `solo_novedad` queda con `foto_requerida = false`, es decir, se comporta como
    `opcional`. No se pierde ninguna fila, sí la distinción.
  * `hay_novedad`: se pierde el registro de qué puntos se resolvieron con una
    novedad declarada. No hay tabla paralela que lo conserve.
  * `snap_politica_foto`: se pierde el congelamiento de la política.

  Antes de ejecutar, exportar lo que se va a perder:

      select rp.id, rp.nombre, rp.politica_foto
        from public.ronda_puntos rp
       where rp.politica_foto <> 'obligatoria';

      select ep.id, ep.ronda_ejecucion_id, ep.orden, ep.hay_novedad,
             ep.snap_politica_foto
        from public.ronda_ejecucion_puntos ep
       where ep.hay_novedad or ep.snap_politica_foto <> 'obligatoria';

QUÉ NO TOCA
  * `foto_requerida` en configuración y `snap_foto_requerida` en ejecución: se
    conservan con el valor que el trigger mantuvo, de modo que el sistema vuelve
    a un estado coherente con el booleano.
  * Puntos registrados, veredictos, GPS, distancias, evidencias y Storage.
  * `rondas_turno_vigente()`, `obtener_ejecucion_actual()`,
    `reordenar_ronda_puntos()`, cierre administrativo
    (C3) y todo el módulo de Supervisor: esta migración no los modificó.

ORDEN
  Primero se restauran las funciones —para que ninguna quede referenciando
  columnas que están por desaparecer—, después el trigger, y al final las
  columnas.
================================================================================
*/

begin;

do $$
declare
  v_puntos   integer := 0;
  v_novedades integer := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='ronda_puntos'
                and column_name='politica_foto') then
    execute 'select count(*) from public.ronda_puntos where politica_foto <> ''obligatoria'''
      into v_puntos;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='ronda_ejecucion_puntos'
                and column_name='hay_novedad') then
    execute 'select count(*) from public.ronda_ejecucion_puntos where hay_novedad'
      into v_novedades;
  end if;

  if v_puntos > 0 or v_novedades > 0 then
    raise warning 'ROLLBACK CON PERDIDA: % punto(s) con politica distinta de obligatoria y % registro(s) con novedad declarada.',
      v_puntos, v_novedades;
  end if;
end;
$$;

-- La firma con p_hay_novedad se elimina para poder recrear la de cuatro
-- parámetros sin dejar dos versiones ambiguas conviviendo.
drop function if exists public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision, boolean
);

-- ── Definición exacta previa: 20260728200000_rondas_ejecucion_base.sql ──────
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

-- ── Definición exacta previa: 20260728234500_rondas_correctivo_c1_c4.sql ────
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

-- ── Definición exacta previa: 20260728234500_rondas_correctivo_c1_c4.sql ────
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

  -- Para GPS obligatorio sólo `dentro_radio = true` permite cumplimiento.
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


-- ── Definición exacta previa: 20260725230000_rondas_correctivo_arquitectura.sql
-- La firma de doce parámetros se elimina para poder recrear la de once sin
-- dejar dos versiones ambiguas.

drop function if exists public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text
);

create or replace function public.agregar_ronda_punto(
  p_ronda_base_id uuid,
  p_nombre text,
  p_descripcion text,
  p_foto_requerida boolean,
  p_gps_requerido boolean,
  p_latitud double precision,
  p_longitud double precision,
  p_precision_metros double precision,
  p_radio_metros integer,
  p_origen_posicion text,
  p_activo boolean
)
returns public.ronda_puntos
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_objetivo_id uuid;
  v_orden integer;
  v_punto public.ronda_puntos;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select rb.objetivo_id
  into v_objetivo_id
  from public.rondas_base rb
  where rb.id = p_ronda_base_id
  for update;

  if not found then
    raise exception 'Ronda base no encontrada';
  end if;
  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    raise exception 'No autorizado para administrar esta ronda';
  end if;

  perform 1
  from public.ronda_puntos rp
  where rp.ronda_base_id = p_ronda_base_id
  for update;

  select coalesce(max(rp.orden), 0) + 1
  into v_orden
  from public.ronda_puntos rp
  where rp.ronda_base_id = p_ronda_base_id;

  if v_orden > 10000 then
    raise exception 'La ronda alcanzo el maximo de puntos permitido';
  end if;

  insert into public.ronda_puntos (
    ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido,
    latitud, longitud, precision_metros, radio_metros, origen_posicion, activo
  ) values (
    p_ronda_base_id, btrim(p_nombre), nullif(btrim(p_descripcion), ''), v_orden,
    p_foto_requerida, p_gps_requerido, p_latitud, p_longitud,
    p_precision_metros, p_radio_metros, p_origen_posicion, p_activo
  )
  returning * into v_punto;

  return v_punto;
end;
$$;

revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
) from public;
revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
) from anon;
grant execute on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
) to authenticated;
-- ── Trigger y columnas ──────────────────────────────────────────────────────

drop trigger if exists trg_ronda_puntos_politica_foto on public.ronda_puntos;
drop function if exists public.ronda_puntos_sincronizar_politica_foto();

alter table public.ronda_ejecucion_puntos
  drop constraint if exists ronda_ejecucion_puntos_snap_politica_foto_valida;

alter table public.ronda_ejecucion_puntos
  drop column if exists hay_novedad,
  drop column if exists snap_politica_foto;

alter table public.ronda_puntos
  drop constraint if exists ronda_puntos_politica_foto_valida;

alter table public.ronda_puntos
  drop column if exists politica_foto;

comment on column public.ronda_puntos.foto_requerida is null;

notify pgrst, 'reload schema';

commit;


/*
================================================================================
Verificación posterior al rollback
================================================================================
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='ronda_puntos'
      and column_name='politica_foto')                                   as col_politica,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='ronda_ejecucion_puntos'
      and column_name in ('snap_politica_foto','hay_novedad'))           as cols_ejecucion,
  (select count(*) from pg_trigger
    where tgrelid='public.ronda_puntos'::regclass
      and tgname='trg_ronda_puntos_politica_foto')                       as trigger_restante,
  (select count(*) from pg_proc
    where oid = to_regprocedure('public.registrar_punto_ronda(uuid,double precision,double precision,double precision)')) as rpc_4_args,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rondas_ejecucion_json'
      and p.prosrc not like '%politica_foto%')                           as json_sin_politica,
  (select count(*) from public.ronda_puntos)                             as puntos_intactos,
  (select count(*) from public.ronda_ejecucion_puntos)                   as ejecucion_puntos_intactos;

-- Esperado: 0 · 0 · 0 · 1 · 1 · sin cambios · sin cambios
================================================================================
*/
