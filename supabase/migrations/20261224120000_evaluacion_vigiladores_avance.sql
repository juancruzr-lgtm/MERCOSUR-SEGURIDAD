-- Evaluación de vigiladores por supervisor: corrección de identidad, Gerencia
-- evalúa y avance para Administración y Gerencia.
--
-- ── 1. Corrección (error de la Etapa 1, 20261223120000) ─────────────────────
-- La Etapa 1 usaba auth.uid() como si fuera usuarios.id. No lo es: en los 105
-- usuarios con login, usuarios.auth_user_id <> usuarios.id, y supervisor_zonas,
-- turnos.guardia_id y la tabla de evaluaciones guardan usuarios.id. Resultado:
-- ningún supervisor real recibía su lista (la tarjeta no aparecía) y la política
-- de lectura nunca le mostraba sus filas. La tabla está vacía (0 filas), así que
-- no hay datos que migrar. Ahora la identidad sale de
-- `evaluacion_evaluador_actual()` = usuarios.id del auth.uid() activo, igual que
-- el resto de la app (es_gerencia_actual, legajo_completar_estado, ...).
--
-- ── 2. Gerencia evalúa (JC, 24/11/2026) ─────────────────────────────────────
-- "Quiero poder verla y poder evaluar": Gerencia (puesto gerencia, admin sin
-- puesto, o delegación vigente) evalúa a TODOS los vigiladores activos con
-- turnos en la ventana hoy-60..hoy+30, sin importar la zona. Administración no
-- evalúa: sólo ve el avance.
--
-- ── 3. Avance (Administración y Gerencia) ───────────────────────────────────
-- `evaluacion_vigiladores_avance(p_periodo)`: por evaluador, cuántos tiene que
-- evaluar, cuántos hizo, el promedio que pone y el detalle de cada evaluación;
-- y por vigilador, cuántas evaluaciones recibió y su promedio. Un único jsonb
-- (PostgREST corta en 1000 filas). El "total a evaluar" se calcula con la
-- ventana de HOY: para un mes pasado es aproximado y la pantalla lo aclara.
--
-- No toca turnos, horas, liquidaciones ni la nota mensual.

begin;

-- ── Identidad: usuarios.id del que llama ────────────────────────────────────
create or replace function public.evaluacion_evaluador_actual()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select u.id from public.usuarios u
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1
$fn$;

revoke all on function public.evaluacion_evaluador_actual() from public, anon;
-- La usa la política de lectura (corre como el usuario): necesita execute.
grant execute on function public.evaluacion_evaluador_actual() to authenticated;

comment on function public.evaluacion_evaluador_actual() is
  'usuarios.id del usuario activo de la sesion (auth.uid() es auth_user_id, no usuarios.id).';

-- ── ¿Ve todas las evaluaciones? ─────────────────────────────────────────────
-- Administración y Gerencia, pero NUNCA un supervisor: Sergio (jefe de
-- supervisores) tiene acceso admin pleno y con sólo puede_gestionar_personal
-- vería lo que ponen Aranda y José Luis sobre los mismos vigiladores de Rosario.
-- JC: "los supervisores solo ven sus evaluaciones".
create or replace function public.evaluacion_ve_todo_actual()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select (public.puede_gestionar_personal_actual() or public.puede_acceder_gerencia_actual())
    and not exists (
      select 1 from public.usuarios u
      where u.auth_user_id = auth.uid()
        and coalesce(u.puesto_organizacional, '') in ('supervisor', 'jefe_supervisores')
    )
$fn$;

revoke all on function public.evaluacion_ve_todo_actual() from public, anon;
grant execute on function public.evaluacion_ve_todo_actual() to authenticated;

comment on function public.evaluacion_ve_todo_actual() is
  'Administracion o Gerencia que NO sea supervisor ni jefe de supervisores. Lectura de todas las evaluaciones de vigiladores.';

-- ── ¿Es Gerencia? (por id, para poder mirarlo sobre cualquier evaluador) ────
create or replace function public.evaluacion_es_gerencia(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select exists (
    select 1 from public.usuarios u
    where u.id = p_usuario_id and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin')
            or public.tiene_delegacion_gerencia(u.id) )
  )
$fn$;

revoke all on function public.evaluacion_es_gerencia(uuid) from public, anon, authenticated;

comment on function public.evaluacion_es_gerencia(uuid) is
  'Mismo criterio que puede_acceder_gerencia_actual, pero por usuarios.id. Interna.';

-- ── Vigiladores que le tocan a un evaluador ─────────────────────────────────
-- Supervisor: los de su zona (igual que antes). Gerencia: todos.
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
  gerencia as (
    select public.evaluacion_es_gerencia(p_supervisor_id) as si
  ),
  turnos_zona as (
    select t.guardia_id, o.nombre, t.fecha
    from public.turnos t
    join public.objetivos o on o.id = t.objetivo_id
    cross join hoy
    cross join gerencia
    where t.fecha between hoy.d - 60 and hoy.d + 30
      and coalesce(t.estado, '') <> 'anulado'
      and t.guardia_id is not null
      and t.guardia_id <> p_supervisor_id
      and (
        gerencia.si
        or o.zona_id in (
          select sz.zona_id from public.supervisor_zonas sz where sz.supervisor_id = p_supervisor_id
        )
      )
  )
  select distinct on (tz.guardia_id) tz.guardia_id, tz.nombre
  from turnos_zona tz
  join public.usuarios u on u.id = tz.guardia_id
  where u.estado = 'activo'
    and coalesce(u.es_prueba, false) = false
    and coalesce(u.puesto_organizacional, '') not in ('supervisor', 'jefe_supervisores', 'gerencia', 'administracion')
  -- El objetivo que se muestra es el del turno más cercano a hoy.
  order by tz.guardia_id, abs(tz.fecha - (select d from hoy))
$fn$;

revoke all on function public.evaluacion_vigiladores_de_zona(uuid) from public, anon, authenticated;

comment on function public.evaluacion_vigiladores_de_zona(uuid) is
  'Vigiladores activos (sin prueba) con turnos hoy-60..hoy+30: en objetivos de las zonas del supervisor, '
  'o en cualquier objetivo si el evaluador es Gerencia. Interna.';

-- ── Lista del mes del que llama ─────────────────────────────────────────────
create or replace function public.evaluacion_vigiladores_mias()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid     uuid := public.evaluacion_evaluador_actual();
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

-- ── Guardar (o corregir) ────────────────────────────────────────────────────
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
  v_uid     uuid := public.evaluacion_evaluador_actual();
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
    updated_at             = now()
  returning e.* into v_fila;

  return to_jsonb(v_fila);
end;
$fn$;

revoke all on function public.evaluacion_vigilador_guardar(uuid, integer, integer, integer, integer, integer, integer, integer, text, text, text) from public, anon;
grant execute on function public.evaluacion_vigilador_guardar(uuid, integer, integer, integer, integer, integer, integer, integer, text, text, text) to authenticated;

-- ── Lectura: el evaluador ve lo suyo (por usuarios.id) ──────────────────────
drop policy if exists "Supervisor ve sus evaluaciones; Administracion y Gerencia todas"
  on public.evaluaciones_vigilador_supervisor;

create policy "Supervisor ve sus evaluaciones; Administracion y Gerencia todas"
  on public.evaluaciones_vigilador_supervisor
  for select to authenticated
  using (
    supervisor_id = public.evaluacion_evaluador_actual()
    or public.evaluacion_ve_todo_actual()
  );

-- ── Avance para Administración y Gerencia ───────────────────────────────────
create or replace function public.evaluacion_vigiladores_avance(p_periodo text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_hoy     date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_actual  text := to_char(v_hoy, 'YYYY-MM');
  v_periodo text;
  v_res     jsonb;
begin
  if not public.evaluacion_ve_todo_actual() then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  v_periodo := coalesce(nullif(btrim(p_periodo), ''), v_actual);
  if v_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periodo invalido: %', v_periodo using errcode = '22023';
  end if;

  v_res := (
  with evaluadores as (
    -- Supervisores con zona, Gerencia y cualquiera que ya haya evaluado ese mes.
    select sz.supervisor_id as id from public.supervisor_zonas sz
    union
    select u.id from public.usuarios u
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
      and public.evaluacion_es_gerencia(u.id)
    union
    select e.supervisor_id from public.evaluaciones_vigilador_supervisor e where e.periodo = v_periodo
  ),
  por_evaluador as (
    select
      u.id, u.nombre, u.apellido,
      public.evaluacion_es_gerencia(u.id) as es_gerencia,
      coalesce((
        select array_agg(distinct z.nombre order by z.nombre)
        from public.supervisor_zonas sz join public.zonas_operativas z on z.id = sz.zona_id
        where sz.supervisor_id = u.id
      ), '{}'::text[]) as zonas,
      (select count(*) from public.evaluacion_vigiladores_de_zona(u.id)) as total,
      (select count(*) from public.evaluaciones_vigilador_supervisor e
        where e.periodo = v_periodo and e.supervisor_id = u.id) as hechas,
      (select round(avg(e.puntaje), 2) from public.evaluaciones_vigilador_supervisor e
        where e.periodo = v_periodo and e.supervisor_id = u.id) as promedio,
      coalesce((
        select jsonb_agg(jsonb_build_object(
            'vigilador_id', v.id, 'nombre', v.nombre, 'apellido', v.apellido, 'legajo', v.legajo,
            'puntaje', e.puntaje,
            'asistencia_puntualidad', e.asistencia_puntualidad, 'pulcritud', e.pulcritud,
            'disposicion', e.disposicion, 'relacion_objetivo', e.relacion_objetivo,
            'relacion_supervisores', e.relacion_supervisores, 'relacion_companeros', e.relacion_companeros,
            'concepto_general', e.concepto_general,
            'observaciones', e.observaciones, 'plan_accion', e.plan_accion,
            'origen', e.origen, 'updated_at', e.updated_at
          ) order by v.apellido, v.nombre)
        from public.evaluaciones_vigilador_supervisor e
        join public.usuarios v on v.id = e.vigilador_id
        where e.periodo = v_periodo and e.supervisor_id = u.id
      ), '[]'::jsonb) as evaluaciones,
      -- Pendientes con nombre sólo para el mes en curso (la ventana es la de hoy).
      case when v_periodo = v_actual then coalesce((
        select jsonb_agg(jsonb_build_object(
            'vigilador_id', v.id, 'nombre', v.nombre, 'apellido', v.apellido,
            'legajo', v.legajo, 'objetivo', z.objetivo_nombre
          ) order by v.apellido, v.nombre)
        from public.evaluacion_vigiladores_de_zona(u.id) z
        join public.usuarios v on v.id = z.vigilador_id
        where not exists (
          select 1 from public.evaluaciones_vigilador_supervisor e
          where e.periodo = v_periodo and e.supervisor_id = u.id and e.vigilador_id = v.id
        )
      ), '[]'::jsonb) else '[]'::jsonb end as pendientes
    from evaluadores ev
    join public.usuarios u on u.id = ev.id
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  ),
  por_vigilador as (
    select v.id, v.nombre, v.apellido, v.legajo,
      count(*) as cantidad,
      round(avg(e.puntaje), 2) as promedio,
      min(e.puntaje) as minimo,
      max(e.puntaje) as maximo
    from public.evaluaciones_vigilador_supervisor e
    join public.usuarios v on v.id = e.vigilador_id
    where e.periodo = v_periodo
    group by v.id, v.nombre, v.apellido, v.legajo
  )
  select jsonb_build_object(
    'periodo', v_periodo,
    'es_mes_actual', v_periodo = v_actual,
    'periodos', coalesce((
      select jsonb_agg(p order by p desc) from (
        select distinct e.periodo as p from public.evaluaciones_vigilador_supervisor e
        union select v_actual
      ) x
    ), '[]'::jsonb),
    'evaluadores', coalesce((
      select jsonb_agg(jsonb_build_object(
          'evaluador_id', pe.id, 'nombre', pe.nombre, 'apellido', pe.apellido,
          'es_gerencia', pe.es_gerencia, 'zonas', to_jsonb(pe.zonas),
          'total', pe.total, 'hechas', pe.hechas, 'promedio', pe.promedio,
          'evaluaciones', pe.evaluaciones, 'pendientes', pe.pendientes
        ) order by pe.es_gerencia, pe.apellido, pe.nombre)
      from por_evaluador pe
    ), '[]'::jsonb),
    'vigiladores', coalesce((
      select jsonb_agg(jsonb_build_object(
          'vigilador_id', pv.id, 'nombre', pv.nombre, 'apellido', pv.apellido, 'legajo', pv.legajo,
          'cantidad', pv.cantidad, 'promedio', pv.promedio, 'minimo', pv.minimo, 'maximo', pv.maximo
        ) order by pv.apellido, pv.nombre)
      from por_vigilador pv
    ), '[]'::jsonb)
  )
  );

  return v_res;
end;
$fn$;

revoke all on function public.evaluacion_vigiladores_avance(text) from public, anon;
grant execute on function public.evaluacion_vigiladores_avance(text) to authenticated;

comment on function public.evaluacion_vigiladores_avance(text) is
  'Avance de la evaluacion de vigiladores del periodo (YYYY-MM; null = mes en curso AR), por evaluador y por vigilador. '
  'Solo Administracion y Gerencia.';

notify pgrst, 'reload schema';

commit;
