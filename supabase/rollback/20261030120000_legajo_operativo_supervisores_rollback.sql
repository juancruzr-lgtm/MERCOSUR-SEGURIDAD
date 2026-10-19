-- Rollback de 20261030120000_legajo_operativo_supervisores.sql. Correr por separado.
-- Sólo borra funciones de lectura: no hay datos que perder.

begin;

drop function if exists public.legajo_supervisor_recorrido(uuid);
drop function if exists public.legajo_supervisores_supervisiones(uuid, date, date);
drop function if exists public.legajo_supervisores_guardias(uuid, date, date);
drop function if exists public.puede_ver_legajo_supervisores_actual();

commit;
