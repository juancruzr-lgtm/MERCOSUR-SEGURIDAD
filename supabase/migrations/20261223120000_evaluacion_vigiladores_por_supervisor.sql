-- Evaluación mensual de vigiladores por supervisor (Etapa 1).
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Pedido de JC (24/11/2026): pasar a la app la planilla en papel
-- "R 6.2 (3) Planilla de Evaluación de vigiladores". Cada mes, cada supervisor
-- evalúa a los vigiladores de su zona con los mismos siete criterios, de 1 a 10
-- "como el resto de la app". El puntaje es el promedio y el concepto sale de la
-- misma escala que la nota mensual (lib/evaluacion-final → conceptoDe).
--
-- ── Quién ve qué ─────────────────────────────────────────────────────────────
--   · el supervisor: sólo SUS evaluaciones, sólo de vigiladores de su zona. No
--     ve lo que puso otro supervisor sobre la misma persona.
--   · Administración y Gerencia: todas (planilla general, Etapa 3).
-- Nadie escribe directo en la tabla: se guarda por `evaluacion_vigilador_guardar`,
-- que toma la identidad de auth.uid() y controla la zona y el mes.
--
-- ── De dónde sale "su zona" ──────────────────────────────────────────────────
-- Mismo criterio que el control del Estatuto (20261027120000): los vigiladores
-- con turnos no anulados entre hoy-60 y hoy+30 en objetivos de alguna zona que
-- el supervisor tiene en supervisor_zonas. Un vigilador que trabaja en dos zonas
-- le aparece a los supervisores de las dos: así se pueden comparar.
--
-- ── Lo que NO hace ───────────────────────────────────────────────────────────
-- No bloquea nada ni toca la nota mensual (evaluaciones_mensuales): sumarla es
-- la Etapa 4 y por ahora queda sólo informativa (decisión de JC, 24/11).
-- No borra: no hay DELETE para nadie.
--
-- Rollback: supabase/rollback/20261223120000_evaluacion_vigiladores_por_supervisor_rollback.sql
-- Sin `select col into variable` (regla del proyecto): se asigna con :=.

begin;

create table if not exists public.evaluaciones_vigilador_supervisor (
  id            uuid primary key default gen_random_uuid(),
  -- 'YYYY-MM' en hora argentina: el mes en que se cargó.
  periodo       text not null check (periodo ~ '^\d{4}-\d{2}$'),
  supervisor_id uuid not null references public.usuarios(id) on delete cascade,
  vigilador_id  uuid not null references public.usuarios(id) on delete cascade,

  -- Las siete columnas de la planilla R 6.2 (3), de 1 a 10.
  asistencia_puntualidad smallint not null check (asistencia_puntualidad between 1 and 10),
  pulcritud              smallint not null check (pulcritud between 1 and 10),
  disposicion            smallint not null check (disposicion between 1 and 10),
  relacion_objetivo      smallint not null check (relacion_objetivo between 1 and 10),
  relacion_supervisores  smallint not null check (relacion_supervisores between 1 and 10),
  relacion_companeros    smallint not null check (relacion_companeros between 1 and 10),
  concepto_general       smallint not null check (concepto_general between 1 and 10),

  -- PUNTAJE de la planilla: el promedio, calculado por la base para que nadie
  -- pueda guardar un puntaje que no cierre con los criterios.
  puntaje numeric(4,2) generated always as (round((
      asistencia_puntualidad + pulcritud + disposicion + relacion_objetivo
    + relacion_supervisores + relacion_companeros + concepto_general
  )::numeric / 7, 2)) stored,

  observaciones text check (observaciones is null or length(observaciones) <= 2000),
  plan_accion   text check (plan_accion is null or length(plan_accion) <= 2000),

  -- 'campana' = desde la lista del mes; 'supervision' = cargada en la visita
  -- (Etapa 2). Las dos completan la misma evaluación del mes.
  origen text not null default 'campana' check (origen in ('campana', 'supervision')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Una por supervisor, vigilador y mes. Volver a guardar la corrige.
  constraint evaluacion_vigilador_unica unique (periodo, supervisor_id, vigilador_id),
  constraint evaluacion_vigilador_no_propia check (supervisor_id <> vigilador_id)
);

create index if not exists evaluaciones_vigilador_supervisor_vigilador_idx
  on public.evaluaciones_vigilador_supervisor (vigilador_id, periodo);
create index if not exists evaluaciones_vigilador_supervisor_periodo_idx
  on public.evaluaciones_vigilador_supervisor (periodo, supervisor_id);

comment on table public.evaluaciones_vigilador_supervisor is
  'Evaluacion mensual de cada vigilador por cada supervisor de su zona (planilla R 6.2 (3)). '
  'Criterios 1 a 10, puntaje = promedio. Se escribe solo por evaluacion_vigilador_guardar.';

-- ── Permisos ─────────────────────────────────────────────────────────────────
-- Los DEFAULT PRIVILEGES dan DELETE/TRUNCATE/UPDATE a authenticated en toda
-- tabla nueva: se sacan todos y se deja sólo la lectura, recortada por RLS.
revoke all on public.evaluaciones_vigilador_supervisor from anon, authenticated;
grant select on public.evaluaciones_vigilador_supervisor to authenticated;

alter table public.evaluaciones_vigilador_supervisor enable row level security;

create policy "Supervisor ve sus evaluaciones; Administracion y Gerencia todas"
  on public.evaluaciones_vigilador_supervisor
  for select to authenticated
  using (
    supervisor_id = auth.uid()
    or public.puede_gestionar_personal_actual()
    or public.puede_acceder_gerencia_actual()
  );

-- ── Vigiladores de la zona de un supervisor ──────────────────────────────────
create or replace function public.evaluacion_vigiladores_de_zona(p_supervisor_id uuid)
returns table (vigilador_id uuid, objetivo_nombre text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  with hoy as (
    select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d
  ),
  turnos_zona as (
    select t.guardia_id, o.nombre, t.fecha
    from public.turnos t
    join public.objetivos o on o.id = t.objetivo_id
    cross join hoy
    where t.fecha between hoy.d - 60 and hoy.d + 30
      and coalesce(t.estado, '') <> 'anulado'
      and t.guardia_id is not null
      and t.guardia_id <> p_supervisor_id
      and o.zona_id in (
        select sz.zona_id from public.supervisor_zonas sz where sz.supervisor_id = p_supervisor_id
      )
  )
  select distinct on (tz.guardia_id) tz.guardia_id, tz.nombre
  from turnos_zona tz
  join public.usuarios u on u.id = tz.guardia_id
  where u.estado = 'activo'
    and coalesce(u.es_prueba, false) = false
    and coalesce(u.puesto_organizacional, '') not in ('supervisor', 'jefe_supervisores')
  -- El objetivo que se muestra es el del turno más cercano a hoy.
  order by tz.guardia_id, abs(tz.fecha - (select d from hoy))
$fn$;

revoke all on function public.evaluacion_vigiladores_de_zona(uuid) from public, anon, authenticated;

comment on function public.evaluacion_vigiladores_de_zona(uuid) is
  'Vigiladores activos (sin prueba) con turnos hoy-60..hoy+30 en objetivos de las zonas del supervisor. '
  'Interna: la usan evaluacion_vigiladores_mias y evaluacion_vigilador_guardar.';

-- ── Lo que ve el supervisor: su lista del mes ────────────────────────────────
-- Un único jsonb (PostgREST corta en 1000 filas sin avisar).
create or replace function public.evaluacion_vigiladores_mias()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_hoy     date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_periodo text;
  v_res     jsonb;
begin
  if v_uid is null then
    raise exception 'Sin sesion' using errcode = '42501';
  end if;

  v_periodo := to_char(v_hoy, 'YYYY-MM');

  v_res := jsonb_build_object(
    'periodo', v_periodo,
    'cierra', (date_trunc('month', v_hoy) + interval '1 month - 1 day')::date,
    'vigiladores', coalesce((
      select jsonb_agg(jsonb_build_object(
          'vigilador_id', u.id,
          'nombre', u.nombre,
          'apellido', u.apellido,
          'legajo', u.legajo,
          'objetivo', z.objetivo_nombre,
          'evaluacion', case when e.id is null then null else to_jsonb(e) end
        ) order by (e.id is not null), u.apellido, u.nombre)
      from public.evaluacion_vigiladores_de_zona(v_uid) z
      join public.usuarios u on u.id = z.vigilador_id
      left join public.evaluaciones_vigilador_supervisor e
        on e.periodo = v_periodo and e.supervisor_id = v_uid and e.vigilador_id = u.id
    ), '[]'::jsonb)
  );

  return v_res;
end;
$fn$;

revoke all on function public.evaluacion_vigiladores_mias() from public, anon;
grant execute on function public.evaluacion_vigiladores_mias() to authenticated;

comment on function public.evaluacion_vigiladores_mias() is
  'Lista del mes del supervisor que llama: los vigiladores de su zona con su evaluacion (o null). '
  'Sin zonas asignadas devuelve la lista vacia.';

-- ── Guardar (o corregir) una evaluación del mes ──────────────────────────────
create or replace function public.evaluacion_vigilador_guardar(
  p_vigilador_id           uuid,
  p_asistencia_puntualidad integer,
  p_pulcritud              integer,
  p_disposicion            integer,
  p_relacion_objetivo      integer,
  p_relacion_supervisores  integer,
  p_relacion_companeros    integer,
  p_concepto_general       integer,
  p_observaciones          text default null,
  p_plan_accion            text default null,
  p_origen                 text default 'campana'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_hoy     date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_periodo text;
  v_fila    public.evaluaciones_vigilador_supervisor;
begin
  if v_uid is null then
    raise exception 'Sin sesion' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.evaluacion_vigiladores_de_zona(v_uid) z where z.vigilador_id = p_vigilador_id
  ) then
    raise exception 'Ese vigilador no esta en tu zona' using errcode = '42501';
  end if;

  v_periodo := to_char(v_hoy, 'YYYY-MM');

  insert into public.evaluaciones_vigilador_supervisor as e (
    periodo, supervisor_id, vigilador_id,
    asistencia_puntualidad, pulcritud, disposicion, relacion_objetivo,
    relacion_supervisores, relacion_companeros, concepto_general,
    observaciones, plan_accion, origen
  ) values (
    v_periodo, v_uid, p_vigilador_id,
    p_asistencia_puntualidad, p_pulcritud, p_disposicion, p_relacion_objetivo,
    p_relacion_supervisores, p_relacion_companeros, p_concepto_general,
    nullif(btrim(p_observaciones), ''), nullif(btrim(p_plan_accion), ''),
    coalesce(p_origen, 'campana')
  )
  on conflict (periodo, supervisor_id, vigilador_id) do update set
    asistencia_puntualidad = excluded.asistencia_puntualidad,
    pulcritud              = excluded.pulcritud,
    disposicion            = excluded.disposicion,
    relacion_objetivo      = excluded.relacion_objetivo,
    relacion_supervisores  = excluded.relacion_supervisores,
    relacion_companeros    = excluded.relacion_companeros,
    concepto_general       = excluded.concepto_general,
    observaciones          = excluded.observaciones,
    plan_accion            = excluded.plan_accion,
    -- El origen queda el de la primera carga: corregir no la convierte en otra.
    updated_at             = now()
  returning e.* into v_fila;

  return to_jsonb(v_fila);
end;
$fn$;

revoke all on function public.evaluacion_vigilador_guardar(uuid, integer, integer, integer, integer, integer, integer, integer, text, text, text) from public, anon;
grant execute on function public.evaluacion_vigilador_guardar(uuid, integer, integer, integer, integer, integer, integer, integer, text, text, text) to authenticated;

comment on function public.evaluacion_vigilador_guardar(uuid, integer, integer, integer, integer, integer, integer, integer, text, text, text) is
  'Guarda o corrige la evaluacion del mes (hora AR) del supervisor que llama sobre un vigilador de su zona. '
  'Criterios 1 a 10 (los valida la tabla); el puntaje lo calcula la base.';

notify pgrst, 'reload schema';

commit;
