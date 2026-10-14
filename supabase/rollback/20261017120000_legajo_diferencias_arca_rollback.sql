-- Rollback de 20261017120000_legajo_diferencias_arca.
-- Ojo: borra las consultas de ARCA cargadas, las revisiones y la traza de correcciones
-- de identidad (las correcciones ya hechas en usuarios NO se deshacen).
begin;
drop function if exists public.legajo_identidad_historial(uuid);
drop function if exists public.legajo_diferencia_reabrir(text);
drop function if exists public.legajo_diferencia_revisar(text, text);
drop function if exists public.legajo_diferencias_resumen();
drop function if exists public.legajo_diferencias(uuid);
drop function if exists public.legajo_corregir_identidad(uuid, text, text, text, text);
drop function if exists public.arca_relaciones_importar(date, text, jsonb);
drop function if exists public.legajo_nombre_compatible(text, text);
drop function if exists public.legajo_nombre_normal(text);
drop function if exists public.cuil_valido(text);
drop table if exists public.legajo_diferencias_revision;
drop table if exists public.legajo_identidad_cambios;
drop table if exists public.arca_relaciones_laborales;
notify pgrst, 'reload schema';
commit;
