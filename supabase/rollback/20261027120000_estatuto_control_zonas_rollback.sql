-- Rollback de 20261027120000_estatuto_control_zonas.sql
-- Devuelve `estatuto_control` a la versión de 20261008150000 (sin zonas).
-- No toca tablas ni constancias. Correr sólo si hay que deshacer la migración.

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
      'personas', coalesce(jsonb_agg(jsonb_build_object(
          'empleado_id', u.id,
          'nombre', u.nombre,
          'apellido', u.apellido,
          'legajo', u.legajo,
          'cuil', u.cuil,
          'rol', u.rol,
          'puesto', u.puesto_organizacional,
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
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  );

  return v_res;
end;
$fn$;

comment on function public.estatuto_control(uuid) is
  'Control de aceptaciones del Estatuto: activos (sin prueba) con apertura y aceptacion '
  'de la version pedida (o la vigente). Solo Administracion y Gerencia.';

notify pgrst, 'reload schema';

commit;
