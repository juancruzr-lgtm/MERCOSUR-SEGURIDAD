-- Estatuto Interno: el control de aceptaciones dice en qué zona trabaja cada uno.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Administración y Gerencia quieren filtrar "quién aceptó y quién falta" por
-- zona (Rosario, Reconquista, Rafaela). Decisión de JC (16/10/2026): es sólo un
-- FILTRO para Administración y Gerencia; Supervisión sigue sin acceso al
-- control, como se decidió el 08/10. Por eso no cambia quién puede llamar a
-- `estatuto_control`: cambia sólo lo que devuelve.
--
-- ── De dónde sale la zona de una persona ─────────────────────────────────────
-- `usuarios` no tiene zona. Se toma de donde trabaja de verdad:
--   · vigiladores: la zona de los objetivos de sus turnos no anulados entre
--     hoy-60 y hoy+30 días (cubre el mes pasado, el actual y la programación
--     publicada). Medido el 16/10: 76 personas con zona, 2 con dos zonas, 3
--     guardias activos sin turnos en la ventana.
--   · supervisores: además, las zonas que tienen asignadas (supervisor_zonas).
-- Una persona puede tener varias zonas y aparece en el filtro de cada una.
-- Quien no tiene ninguna (Administración, Gerencia, o un vigilador sin turnos
-- en la ventana) va como "Sin zona": no se la esconde del total.
--
-- ── Qué NO cambia ────────────────────────────────────────────────────────────
-- Misma firma (`estatuto_control(uuid)`), mismo control de acceso, mismo
-- universo (activos sin cuentas de prueba), mismo jsonb único (PostgREST corta
-- en 1000 filas). Sólo se agregan claves: `personas[].zonas` y `zonas` (el
-- catálogo, para armar el selector aunque una zona no tenga a nadie).
-- La aceptación, la apertura, las tablas y la inmutabilidad no se tocan.
--
-- Rollback: supabase/rollback/20261027120000_estatuto_control_zonas_rollback.sql
-- Sin `select col into variable` (regla del proyecto): se asigna con :=.

begin;

create or replace function public.estatuto_control(p_version_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_version uuid;
  v_res     jsonb;
begin
  if auth.uid() is null
     or not (public.puede_gestionar_personal_actual() or public.puede_acceder_gerencia_actual()) then
    raise exception 'Solo Administracion o Gerencia' using errcode = '42501';
  end if;

  v_version := coalesce(p_version_id, public.estatuto_version_vigente_id());

  v_res := (
    select jsonb_build_object(
      'version_id', v_version,
      'zonas', coalesce((
          select jsonb_agg(jsonb_build_object('id', z.id, 'nombre', z.nombre) order by z.nombre)
          from public.zonas_operativas z
        ), '[]'::jsonb),
      'personas', coalesce(jsonb_agg(jsonb_build_object(
          'empleado_id', u.id,
          'nombre', u.nombre,
          'apellido', u.apellido,
          'legajo', u.legajo,
          'cuil', u.cuil,
          'rol', u.rol,
          'puesto', u.puesto_organizacional,
          'zonas', zs.zonas,
          'abierto_at', ap.abierto_at,
          'aceptado_at', ac.aceptado_at,
          'ultima_version_aceptada', ul.version_identificador,
          'ultima_aceptacion_at', ul.aceptado_at
        ) order by u.apellido, u.nombre), '[]'::jsonb)
    )
    from public.usuarios u
    left join public.estatuto_aperturas ap
      on ap.version_id = v_version and ap.empleado_id = u.id
    left join public.estatuto_aceptaciones ac
      on ac.version_id = v_version and ac.empleado_id = u.id
    left join lateral (
      select a.version_identificador, a.aceptado_at
      from public.estatuto_aceptaciones a
      where a.empleado_id = u.id
      order by a.aceptado_at desc
      limit 1
    ) ul on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'nombre', z.nombre) order by z.nombre), '[]'::jsonb) as zonas
      from public.zonas_operativas z
      where z.id in (
        select o.zona_id
        from public.turnos t
        join public.objetivos o on o.id = t.objetivo_id
        where t.guardia_id = u.id
          and t.fecha between current_date - 60 and current_date + 30
          and coalesce(t.estado, '') <> 'anulado'
          and o.zona_id is not null
        union
        select sz.zona_id
        from public.supervisor_zonas sz
        where sz.supervisor_id = u.id
      )
    ) zs on true
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  );

  return v_res;
end;
$fn$;

-- Sin revoke/grant: `create or replace` conserva los permisos que dejó
-- 20261008150000 (sólo authenticated), y así la migración no trae sentencias
-- que obliguen a correrla a mano.

comment on function public.estatuto_control(uuid) is
  'Control de aceptaciones del Estatuto: activos (sin prueba) con apertura, aceptacion '
  'y zonas (turnos hoy-60..hoy+30 y zonas asignadas) de la version pedida (o la vigente). '
  'Solo Administracion y Gerencia.';

notify pgrst, 'reload schema';

commit;
