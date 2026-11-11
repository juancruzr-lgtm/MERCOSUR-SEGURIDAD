-- Rollback de 20261211110000_postulacion_completar_legajo.sql
-- OJO: los datos ya cargados en legajos quedan (están en legajo_cambios_datos con
-- origen 'solicitud_empleo'). Las postulaciones 'legajo_completado' vuelven a
-- 'revisado' sin vínculo para poder restaurar el check original.
begin;
drop function if exists public.postulacion_completar_legajo(uuid, uuid);
update public.postulaciones set estado = 'revisado', usuario_id = null where estado = 'legajo_completado';
alter table public.postulaciones drop constraint if exists postulaciones_estado_check;
alter table public.postulaciones add constraint postulaciones_estado_check
  check (estado = any (array['entrevistado', 'revisado', 'aprobado_ingreso', 'alta_efectiva', 'descartado']));
create or replace function public.legajo_datos_solicitud(p_empleado_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select case when not coalesce(public.legajo_puede_gestionar(), false) then null else (
    select jsonb_build_object('postulacion_id', p.id, 'fecha_entrevista', p.fecha_entrevista, 'alta_at', p.alta_at,
      'datos', coalesce(p.datos_seleccion, '{}'::jsonb), 'observaciones', p.observaciones,
      'archivos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'orden', a.orden, 'mime', a.mime) order by a.orden)
                              from public.postulacion_archivos a where a.postulacion_id = p.id), '[]'::jsonb))
      from public.postulaciones p where p.usuario_id = p_empleado_id and p.estado = 'alta_efectiva'
     order by p.alta_at desc nulls last limit 1) end
$$;
commit;
