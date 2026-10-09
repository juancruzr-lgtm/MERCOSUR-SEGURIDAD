-- Rollback de 20261009130000_legajo_datos_personales.
-- ATENCIÓN: borra los datos personales cargados y el historial de cambios.
-- Exportar antes:  select * from public.legajo_datos_personales;
--                  select * from public.legajo_cambios_datos;
begin;
drop function if exists public.legajo_cambios_pendientes();
drop function if exists public.legajo_datos_de_empleado(uuid);
drop function if exists public.legajo_confirmar_planilla(uuid, text, text);
drop function if exists public.legajo_resolver_cambio(uuid, text, text);
drop function if exists public.legajo_proponer_cambio(uuid, text, text, text);
drop function if exists public.legajo_validar_valor(text, text);
drop function if exists public.legajo_aplicar(uuid, text, text, uuid);
drop function if exists public.legajo_valor_actual(uuid, text);
drop function if exists public.legajo_usuario_actual();
drop table if exists public.legajo_cambios_datos;
drop table if exists public.legajo_datos_personales;
drop table if exists public.legajo_campos;
drop function if exists public.legajo_habilitar(text, boolean);
drop function if exists public.legajo_exigir_habilitado(text);
drop function if exists public.legajo_modulo_habilitado(text);
drop table if exists public.legajo_habilitacion;
drop function if exists public.legajo_puede_gestionar();
drop function if exists public.legajo_cambio_proteger();
notify pgrst, 'reload schema';
commit;
