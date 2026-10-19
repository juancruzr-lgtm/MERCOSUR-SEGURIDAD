-- Rollback de 20261030120000_legajo_operativo_supervisores.sql. Correr por separado.
-- Borra funciones de lectura y la tabla de autorizaciones (4 filas, se
-- recrean volviendo a aplicar la migración). No hay datos operativos.

begin;

drop function if exists public.legajo_supervisor_recorrido(uuid);
drop function if exists public.legajo_supervisores_supervisiones(uuid, date, date);
drop function if exists public.legajo_supervisores_guardias(uuid, date, date);
drop function if exists public.puede_ver_legajo_supervisores_actual();
drop function if exists public.puede_ver_legajo_supervisores(uuid);
drop table if exists public.legajo_supervisores_accesos;

commit;
