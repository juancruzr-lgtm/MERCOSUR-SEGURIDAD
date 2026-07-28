/*
================================================================================
ETAPA 3 — FASE 1: base transaccional de la ejecución de rondas
================================================================================

ALCANCE
  Tablas de ejecución, snapshots, restricciones, índices, RLS y dos RPC:
  iniciar/recuperar una ejecución y consultar la ejecución actual.

  NO incluye: registro de puntos, omisión, finalización, cancelación, fotos,
  storage, interfaz, reportes, cron, alertas ni push. Tampoco modifica
  `obtener_rondas_guardia_actual()`, que sigue devolviendo `ejecucion_actual:
  null` hasta la Fase 5.

DECISIONES CERRADAS QUE IMPLEMENTA

  1. Reemplazo de guardia (opción A). La ejecución pertenece al guardia que la
     inició. El reemplazante no la continúa: inicia una propia. No se cierra ni
     se transfiere nada.

     Consecuencia asumida: una reasignación actualiza `turnos.guardia_id`, y la
     resolución de turno vigente filtra por ese campo. Desde ese momento el
     guardia saliente ya no alcanza su ejecución, que queda `en_curso` sin poder
     finalizarse. Es el precio de no tocar historial, y es deliberado.

  2. Concurrencia: como máximo una ejecución `en_curso` por (turno, guardia).

     La clave incluye `guardia_id` —y no es sólo por el reemplazo—: con clave
     únicamente por guardia, una ejecución abandonada ayer bloquearía el trabajo
     de hoy en otro turno, porque en esta etapa no hay cierre automático.

  3. Contrato `ejecucion_actual`: se respetan los nombres ya declarados en
     lib/rondas.ts (`hora_inicio`, `hora_fin`, `porcentaje`,
     `puntos_completados`, `punto_actual_id`) y se extiende de forma aditiva con
     `puntos_total`, `puede_continuar` y `resultado`.

ESTADOS
  ronda_ejecuciones.estado    : en_curso | finalizada | cancelada
  ronda_ejecuciones.resultado : completa | incompleta   (sólo si finalizada)
  ronda_ejecucion_puntos.estado: pendiente | cumplido | incumplido | omitido

  Se descartaron `iniciada` (derivable de que no haya puntos cumplidos) y
  `vencida` (requiere cron, fuera de alcance; una ejecución abandonada se
  detecta por consulta contra la ventana del turno, sin columna nueva).

INMUTABILIDAD
  Las filas de puntos se pre-crean al iniciar, con snapshot de nombre, orden,
  coordenadas, radio y exigencias. Si mañana el supervisor mueve un punto o lo
  renombra, la ejecución histórica conserva las reglas vigentes en su momento.
  Las FK se mantienen para integridad y joins; el snapshot, para verdad
  histórica. Ambas cosas, no una u otra.

IDENTIDAD
  El cliente sólo envía `p_ronda_base_id`, y se valida que pertenezca al puesto
  del turno vigente. Guardia, turno, objetivo y puesto se derivan de
  `auth.uid()`. Toda hora sale de `now()`.

ROLLBACK
  supabase/rollback/20260728200000_rondas_ejecucion_base_rollback.sql
================================================================================
*/

begin;

-- ── Tablas ──────────────────────────────────────────────────────────────────

create table public.ronda_ejecuciones (
  id                     uuid primary key default gen_random_uuid(),
  ronda_base_id          uuid not null references public.rondas_base(id) on delete restrict,
  turno_id               uuid not null references public.turnos(id) on delete restrict,
  guardia_id             uuid not null references public.usuarios(id) on delete restrict,
  objetivo_id            uuid not null,
  puesto_id              uuid not null,
  fecha_operativa        date not null,
  iniciada_at            timestamptz not null default now(),
  finalizada_at          timestamptz null,
  estado                 text not null default 'en_curso',
  resultado              text null,
  iniciada_fuera_horario boolean not null default false,
  puntos_total           integer not null,
  snap_ronda_nombre      text not null,
  snap_intervalo_minutos integer not null,
  snap_hora_inicio       time null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ronda_ejecuciones_puesto_objetivo_fkey
    foreign key (puesto_id, objetivo_id)
    references public.puestos (id, objetivo_id),

  constraint ronda_ejecuciones_estado_valido
    check (estado in ('en_curso', 'finalizada', 'cancelada')),

  constraint ronda_ejecuciones_resultado_valido
    check (resultado is null or resultado in ('completa', 'incompleta')),

  -- El resultado sólo tiene sentido en una ejecución finalizada, y toda
  -- finalizada debe tenerlo.
  constraint ronda_ejecuciones_resultado_coherente
    check ((estado = 'finalizada') = (resultado is not null)),

  -- finalizada_at acompaña al cierre, en cualquiera de sus dos formas.
  constraint ronda_ejecuciones_cierre_coherente
    check ((estado = 'en_curso') = (finalizada_at is null)),

  constraint ronda_ejecuciones_puntos_total_valido
    check (puntos_total > 0)
);

comment on table public.ronda_ejecuciones is
  'Una ejecución de una ronda por un guardia en un turno. Los campos snap_* son '
  'copia del estado de la configuración al iniciar: la ejecución no cambia si '
  'después se edita la ronda base.';

create table public.ronda_ejecucion_puntos (
  id                  uuid primary key default gen_random_uuid(),
  ronda_ejecucion_id  uuid not null references public.ronda_ejecuciones(id) on delete cascade,
  ronda_punto_id      uuid not null references public.ronda_puntos(id) on delete restrict,
  orden               integer not null,
  snap_nombre         text not null,
  snap_latitud        double precision null,
  snap_longitud       double precision null,
  snap_radio_metros   integer null,
  snap_foto_requerida boolean not null,
  snap_gps_requerido  boolean not null,
  registrado_at       timestamptz null,
  latitud             double precision null,
  longitud            double precision null,
  precision_metros    double precision null,
  distancia_metros    double precision null,
  gps_ok              boolean null,
  dentro_radio        boolean null,
  foto_ok             boolean null,
  estado              text not null default 'pendiente',
  comentario          text null,
  created_at          timestamptz not null default now(),

  constraint ronda_ejecucion_puntos_estado_valido
    check (estado in ('pendiente', 'cumplido', 'incumplido', 'omitido')),

  constraint ronda_ejecucion_puntos_orden_valido
    check (orden between 1 and 10000),

  -- Un punto pendiente todavía no fue registrado; uno resuelto sí.
  constraint ronda_ejecucion_puntos_registro_coherente
    check ((estado = 'pendiente') = (registrado_at is null)),

  constraint ronda_ejecucion_puntos_coordenadas_completas
    check ((latitud is null) = (longitud is null)),

  constraint ronda_ejecucion_puntos_snap_coordenadas_completas
    check ((snap_latitud is null) = (snap_longitud is null)),

  constraint ronda_ejecucion_puntos_unico_por_ejecucion
    unique (ronda_ejecucion_id, ronda_punto_id),

  constraint ronda_ejecucion_puntos_orden_unico
    unique (ronda_ejecucion_id, orden)
);

comment on column public.ronda_ejecucion_puntos.estado is
  'Veredicto del servidor. Los hechos que lo sustentan (gps_ok, dentro_radio, '
  'foto_ok, distancia_metros) se guardan por separado: un punto puede fallar por '
  'más de un motivo a la vez y una sola columna no podría representarlo.';

comment on column public.ronda_ejecucion_puntos.gps_ok is
  'null = no correspondía (el punto no exige GPS). Distinto de false, que es '
  'que se exigía y no se obtuvo. Igual criterio en dentro_radio y foto_ok.';

-- ── Índices ─────────────────────────────────────────────────────────────────

-- Invariante central: un guardia no puede tener dos ejecuciones abiertas en el
-- mismo turno. Deja lugar a la ejecución del reemplazante sobre ese turno.
create unique index ronda_ejecuciones_turno_guardia_en_curso_unique
  on public.ronda_ejecuciones (turno_id, guardia_id)
  where estado = 'en_curso';

create index idx_ronda_ejecuciones_guardia_fecha   on public.ronda_ejecuciones (guardia_id, fecha_operativa desc);
create index idx_ronda_ejecuciones_objetivo_fecha  on public.ronda_ejecuciones (objetivo_id, fecha_operativa desc);
create index idx_ronda_ejecuciones_puesto_fecha    on public.ronda_ejecuciones (puesto_id, fecha_operativa desc);
create index idx_ronda_ejecuciones_ronda_fecha     on public.ronda_ejecuciones (ronda_base_id, fecha_operativa desc);
create index idx_ronda_ejecuciones_turno           on public.ronda_ejecuciones (turno_id);
create index idx_ronda_ejecuciones_en_curso        on public.ronda_ejecuciones (iniciada_at) where estado = 'en_curso';

create index idx_ronda_ejecucion_puntos_ejecucion  on public.ronda_ejecucion_puntos (ronda_ejecucion_id, orden);
create index idx_ronda_ejecucion_puntos_pendientes on public.ronda_ejecucion_puntos (ronda_ejecucion_id, orden) where estado = 'pendiente';
create index idx_ronda_ejecucion_puntos_punto      on public.ronda_ejecucion_puntos (ronda_punto_id);

create trigger trg_ronda_ejecuciones_updated_at
  before update on public.ronda_ejecuciones
  for each row execute function public.set_updated_at();

-- ── Turno vigente: definición compartida ────────────────────────────────────
-- Extrae la lógica que hoy vive dentro de obtener_rondas_guardia_actual() para
-- que exista una sola definición de "turno vigente" en el sistema. Esa RPC no se
-- modifica en esta fase: se hará en la Fase 5, cuando haya que tocarla igual
-- para poblar ejecucion_actual.

create or replace function public.rondas_turno_vigente()
returns table (
  usuario_id      uuid,
  turno_id        uuid,
  objetivo_id     uuid,
  puesto_id       uuid,
  fecha_operativa date,
  ahora_local     timestamp
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario_id uuid;
  v_ahora      timestamp;
  v_hoy        date;
begin
  select u.id into v_usuario_id
    from public.usuarios u
   where u.auth_user_id = auth.uid()
     and u.estado = 'activo'
   limit 1;

  if v_usuario_id is null then
    return;
  end if;

  -- Los turnos guardan fecha + time locales. Comparar en hora local evita el
  -- corrimiento por UTC y soporta el cruce de medianoche.
  v_ahora := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_hoy   := v_ahora::date;

  return query
  select
    v_usuario_id,
    t.id,
    t.objetivo_id,
    t.puesto_id,
    t.fecha,          -- fecha operativa: la del turno, nunca la del reloj
    v_ahora
  from public.turnos t
  where t.guardia_id = v_usuario_id
    and t.fecha in (v_hoy, v_hoy - 1)
    and (t.fecha + t.hora_inicio) <= v_ahora
    and v_ahora < (
      t.fecha + t.hora_fin
      + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end
    )
  order by (t.fecha + t.hora_inicio) desc
  limit 1;
end;
$$;

revoke all on function public.rondas_turno_vigente() from public;
revoke all on function public.rondas_turno_vigente() from anon;
grant execute on function public.rondas_turno_vigente() to authenticated;

-- ── Serialización del contrato ──────────────────────────────────────────────
-- Un único lugar que arma `ejecucion_actual`, para que iniciar y consultar no
-- puedan divergir. Respeta los nombres ya declarados en lib/rondas.ts.

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

-- ── RPC: iniciar o recuperar ────────────────────────────────────────────────

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

-- ── RPC: consultar la ejecución actual ──────────────────────────────────────

create or replace function public.obtener_ejecucion_actual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ctx          record;
  v_ejecucion_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'ejecucion', null);
  end if;

  select * into v_ctx from public.rondas_turno_vigente();
  if v_ctx.turno_id is null then
    return jsonb_build_object('contexto', 'sin_turno_vigente', 'ejecucion', null);
  end if;

  -- Sólo la del guardia autenticado. La del guardia reemplazado, si existe, no
  -- se devuelve nunca.
  select e.id into v_ejecucion_id
    from public.ronda_ejecuciones e
   where e.turno_id  = v_ctx.turno_id
     and e.guardia_id = v_ctx.usuario_id
     and e.estado    = 'en_curso'
   limit 1;

  if v_ejecucion_id is null then
    return jsonb_build_object('contexto', 'sin_ejecucion', 'ejecucion', null);
  end if;

  return jsonb_build_object(
    'contexto',  'ok',
    'ejecucion', public.rondas_ejecucion_json(v_ejecucion_id)
  );
end;
$$;

revoke all on function public.obtener_ejecucion_actual() from public;
revoke all on function public.obtener_ejecucion_actual() from anon;
grant execute on function public.obtener_ejecucion_actual() to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mismo patrón que rondas_base: el vigilador NO tiene ninguna política. Su
-- acceso ocurre exclusivamente por las RPC SECURITY DEFINER. Admin y supervisor
-- de la zona obtienen lectura para los reportes de etapas siguientes.
-- Ningún rol recibe INSERT, UPDATE ni DELETE: escribir es potestad de las RPC.

alter table public.ronda_ejecuciones      enable row level security;
alter table public.ronda_ejecucion_puntos enable row level security;

create policy "Admin supervisor lee ejecuciones de su alcance"
on public.ronda_ejecuciones
for select to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id));

create policy "Admin supervisor lee puntos de ejecucion de su alcance"
on public.ronda_ejecucion_puntos
for select to authenticated
using (
  exists (
    select 1 from public.ronda_ejecuciones e
     where e.id = ronda_ejecucion_puntos.ronda_ejecucion_id
       and public.puede_administrar_rondas_objetivo(e.objetivo_id)
  )
);

revoke all on table public.ronda_ejecuciones      from anon;
revoke all on table public.ronda_ejecucion_puntos from anon;
revoke all on table public.ronda_ejecuciones      from authenticated;
revoke all on table public.ronda_ejecucion_puntos from authenticated;
grant select on table public.ronda_ejecuciones      to authenticated;
grant select on table public.ronda_ejecucion_puntos to authenticated;

notify pgrst, 'reload schema';

commit;
