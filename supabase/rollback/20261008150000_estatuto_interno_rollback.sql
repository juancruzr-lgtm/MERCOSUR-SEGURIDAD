-- Rollback de 20261008150000_estatuto_interno
--
-- Quita el módulo Estatuto Interno (versiones, aperturas, constancias y RPC).
--
-- ATENCIÓN: si la versión ya se publicó y hubo aceptaciones, esto BORRA las
-- constancias. Son prueba de que cada persona declaró haber leído el Estatuto:
-- exportarlas antes y guardarlas fuera de la base:
--   select * from public.estatuto_versiones;
--   select * from public.estatuto_aperturas;
--   select * from public.estatuto_aceptaciones;
-- Los triggers de inmutabilidad impiden DELETE/TRUNCATE, pero no DROP TABLE.

begin;

drop function if exists public.estatuto_control(uuid);
drop function if exists public.estatuto_publicar_version(uuid);
drop function if exists public.estatuto_aceptar(uuid);
drop function if exists public.estatuto_registrar_apertura(uuid);
drop function if exists public.estatuto_texto_declaracion();
drop function if exists public.estatuto_version_vigente_id();

drop table if exists public.estatuto_aceptaciones;
drop table if exists public.estatuto_aperturas;
drop table if exists public.estatuto_versiones;

drop function if exists public.estatuto_version_proteger();
drop function if exists public.estatuto_registro_inmutable();

notify pgrst, 'reload schema';

commit;
