/*
================================================================================
POLÍTICA DE FOTO POR PUNTO — reemplaza el booleano "foto obligatoria sí/no"
================================================================================

ALCANCE
  `ronda_puntos.politica_foto` con tres valores:
    obligatoria   comportamiento actual: sin foto no se registra el punto.
    opcional      se puede registrar sin foto; si el vigilador la saca, se guarda.
    solo_novedad  se puede registrar sin foto, salvo que el vigilador marque que
                  hay una novedad: en ese caso la foto pasa a ser obligatoria.

QUÉ NO TOCA
  GPS, radios, distancias, Haversine, veredicto por posición, asistencia,
  turnos, liquidables, cierre administrativo (C3) ni ninguna superficie de
  Supervisor. `rondas_turno_vigente()`, `obtener_ejecucion_actual()`,
  `agregar_ronda_punto()` y `reordenar_ronda_puntos()` quedan sin modificar.

--------------------------------------------------------------------------------
DOS DESVÍOS RESPECTO DEL PEDIDO, DELIBERADOS
--------------------------------------------------------------------------------
  1. Se modifican `iniciar_ronda()`, `registrar_punto_ronda()` y
     `rondas_ejecucion_json()`, pese a la indicación de no tocar RPC.

     No hay alternativa: `solo_novedad` necesita que el vigilador señale la
     novedad —parámetro nuevo en el registro— y la política debe congelarse al
     iniciar la ronda. Sin snapshot, editar un punto cambiaría las reglas de una
     ejecución en curso, que es justo lo que la Etapa 3.1 se propuso impedir.

     Los cambios son aditivos: el parámetro nuevo tiene default, y las claves
     nuevas del JSON no reemplazan a ninguna existente.

  2. El backfill NO deja todos los puntos en `obligatoria`.

     El pedido decía "todos los puntos existentes deben quedar en obligatoria"
     junto con "mantener compatibilidad hacia atrás". Las dos cosas se
     contradicen: hoy existen puntos con `foto_requerida = false`, y ponerlos en
     `obligatoria` les cambiaría el comportamiento en producción — un punto que
     nunca pidió foto empezaría a bloquear al vigilador.

     Se mapea preservando la conducta:
         foto_requerida = true   ->  obligatoria
         foto_requerida = false  ->  opcional

     La migración informa por NOTICE cuántos puntos caen en cada rama. Si se
     prefiere la lectura literal, es cambiar el CASE del bloque de backfill.
--------------------------------------------------------------------------------

COMPATIBILIDAD
  `foto_requerida` no se elimina. Pasa a ser una columna derivada, mantenida por
  trigger en ambos sentidos:
    * quien escribe `politica_foto` manda, y `foto_requerida` se recalcula;
    * quien escribe sólo `foto_requerida` —como `agregar_ronda_punto()`, que no
      se modifica— define la política equivalente.
  Así ningún lector ni escritor existente se rompe.

ROLLBACK
  supabase/rollback/20260729120000_ronda_puntos_politica_foto_rollback.sql
================================================================================
*/

begin;

-- ── Configuración: política por punto ───────────────────────────────────────

alter table public.ronda_puntos
  add column politica_foto text;

do $$
declare
  v_obligatorias integer;
  v_opcionales   integer;
begin
  update public.ronda_puntos
     set politica_foto = case when foto_requerida then 'obligatoria' else 'opcional' end
   where politica_foto is null;

  select count(*) filter (where politica_foto = 'obligatoria'),
         count(*) filter (where politica_foto = 'opcional')
    into v_obligatorias, v_opcionales
    from public.ronda_puntos;

  raise notice 'Backfill de politica_foto: % obligatoria(s), % opcional(es). Ninguno queda en solo_novedad.',
    v_obligatorias, v_opcionales;
end;
$$;

-- SIN DEFAULT, a propósito. Un default llenaría la columna ANTES de que corra el
-- trigger BEFORE, y entonces un escritor previo que sólo manda
-- `foto_requerida = false` vería su valor pisado a true. Dejarla sin default hace
-- que "no la mandaron" llegue como null, que es la señal que el trigger usa para
-- derivarla del booleano. El NOT NULL se cumple igual: el trigger la completa
-- antes de que se valide la restricción.
alter table public.ronda_puntos
  alter column politica_foto set not null,
  add constraint ronda_puntos_politica_foto_valida
    check (politica_foto in ('obligatoria', 'opcional', 'solo_novedad'));

comment on column public.ronda_puntos.politica_foto is
  'Fuente de verdad de la exigencia de foto. `foto_requerida` es derivada y se '
  'mantiene por trigger sólo para compatibilidad con lectores previos.';

comment on column public.ronda_puntos.foto_requerida is
  'DERIVADA de politica_foto (= politica_foto = ''obligatoria''). No escribir '
  'directamente en código nuevo: usar politica_foto.';

-- Mantiene las dos columnas coherentes sin obligar a que todos los escritores
-- conozcan la nueva. Si llegan ambas y se contradicen, manda `politica_foto`.
create or replace function public.ronda_puntos_sincronizar_politica_foto()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.politica_foto is null then
      -- Escritor previo: sólo mandó foto_requerida.
      new.politica_foto := case when new.foto_requerida then 'obligatoria' else 'opcional' end;
    else
      new.foto_requerida := (new.politica_foto = 'obligatoria');
    end if;
    return new;
  end if;

  if new.politica_foto is distinct from old.politica_foto then
    new.foto_requerida := (new.politica_foto = 'obligatoria');
  elsif new.foto_requerida is distinct from old.foto_requerida then
    new.politica_foto := case when new.foto_requerida then 'obligatoria' else 'opcional' end;
  end if;

  return new;
end;
$$;

revoke all on function public.ronda_puntos_sincronizar_politica_foto() from public;
revoke all on function public.ronda_puntos_sincronizar_politica_foto() from anon;
revoke all on function public.ronda_puntos_sincronizar_politica_foto() from authenticated;

drop trigger if exists trg_ronda_puntos_politica_foto on public.ronda_puntos;
create trigger trg_ronda_puntos_politica_foto
  before insert or update on public.ronda_puntos
  for each row execute function public.ronda_puntos_sincronizar_politica_foto();

-- Los grants son por columna en esta tabla: sin esto el editor no puede escribir.
grant insert (politica_foto) on table public.ronda_puntos to authenticated;
grant update (politica_foto) on table public.ronda_puntos to authenticated;

-- ── agregar_ronda_punto: aceptar la política al crear ───────────────────────
-- Sin esto la política sólo podría fijarse editando un punto ya creado: el alta
-- pasa por esta RPC y su parámetro booleano perdería `solo_novedad`. Se elimina
-- la firma de once parámetros porque, con un duodécimo con default, toda llamada
-- de once argumentos quedaría ambigua. El cuerpo es el mismo salvo la columna
-- nueva en el INSERT.

drop function if exists public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
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
  p_activo boolean,
  p_politica_foto text default null
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

  -- politica_foto null deja que el trigger la derive de p_foto_requerida: es lo
  -- que mantiene compatible a cualquier cliente que todavía no la envíe.
  insert into public.ronda_puntos (
    ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido,
    latitud, longitud, precision_metros, radio_metros, origen_posicion, activo,
    politica_foto
  ) values (
    p_ronda_base_id, btrim(p_nombre), nullif(btrim(p_descripcion), ''), v_orden,
    coalesce(p_foto_requerida, true), p_gps_requerido, p_latitud, p_longitud,
    p_precision_metros, p_radio_metros, p_origen_posicion, p_activo,
    p_politica_foto
  )
  returning * into v_punto;

  return v_punto;
end;
$$;

revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text
) from public;
revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text
) from anon;
grant execute on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text
) to authenticated;

-- ── Ejecución: snapshot de la política y marca de novedad ───────────────────

alter table public.ronda_ejecucion_puntos
  add column snap_politica_foto text,
  add column hay_novedad boolean not null default false;

update public.ronda_ejecucion_puntos
   set snap_politica_foto = case when snap_foto_requerida then 'obligatoria' else 'opcional' end
 where snap_politica_foto is null;

alter table public.ronda_ejecucion_puntos
  alter column snap_politica_foto set not null,
  add constraint ronda_ejecucion_puntos_snap_politica_foto_valida
    check (snap_politica_foto in ('obligatoria', 'opcional', 'solo_novedad'));

comment on column public.ronda_ejecucion_puntos.snap_politica_foto is
  'Política vigente al iniciar la ronda. Editar el punto después no cambia las '
  'reglas de una ejecución ya en curso.';

comment on column public.ronda_ejecucion_puntos.hay_novedad is
  'El vigilador declaró una novedad al registrar el punto. Con política '
  'solo_novedad, es lo que vuelve obligatoria la foto.';

-- ── iniciar_ronda: copiar la política al snapshot ───────────────────────────
-- Único cambio: dos columnas más en el INSERT del snapshot. El resto de la
-- función queda idéntico a 20260728234500_rondas_correctivo_c1_c4.sql.

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

-- ── Contrato: exponer la política y la novedad ──────────────────────────────
-- Aditivo. `requiere_foto` se conserva para no romper a ningún consumidor.

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

-- ── registrar_punto_ronda: la política decide si la foto bloquea ────────────
-- La firma vieja se elimina: con un quinto parámetro con default, convivir con
-- ella dejaría ambigua toda llamada de 1 a 4 argumentos.

drop function if exists public.registrar_punto_ronda(
  uuid, double precision, double precision, double precision
);

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

notify pgrst, 'reload schema';

commit;
