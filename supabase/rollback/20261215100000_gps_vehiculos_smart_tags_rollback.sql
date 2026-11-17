-- Rollback 20261215100000_gps_vehiculos_smart_tags.
-- Elimina el módulo Vehículos de supervisión / Smart Tags. NO toca supervisor_route_points
-- ni ninguna otra tabla del GPS de teléfonos.
-- ATENCIÓN: borra el historial de posiciones de Smart Tags. Si hay datos reales, exportarlos antes:
--   copy (select * from public.gps_tag_posiciones) to stdout with csv header;
--   copy (select * from public.gps_tag_consultas) to stdout with csv header;

drop function if exists public.gps_tag_registrar_consulta(uuid, timestamptz, text, jsonb, smallint, integer, text, text);
drop function if exists public.gps_vehiculos_registrar_acceso(text, uuid, jsonb);
drop function if exists public.gps_vehiculo_asignar_supervisor(uuid, uuid, text);
drop function if exists public.gps_vehiculo_asignar_tag(uuid, uuid, text);
drop function if exists public.gps_vehiculo_guardar(uuid, text, text, text, text);
drop function if exists public.gps_tag_guardar(uuid, text, text, text, text, boolean, text);

drop table if exists public.gps_vehiculos_accesos;
drop table if exists public.gps_tag_posiciones;
drop table if exists public.gps_tag_consultas;
drop table if exists public.gps_vehiculo_supervisor_asignaciones;
drop table if exists public.gps_vehiculo_tag_asignaciones;
drop table if exists public.gps_vehiculos;
drop table if exists public.gps_tags;

drop function if exists public.gps_usuario_actual_id();
drop function if exists public.gps_vehiculos_puede_gestionar_actual();
drop function if exists public.gps_vehiculos_puede_ver_actual();
