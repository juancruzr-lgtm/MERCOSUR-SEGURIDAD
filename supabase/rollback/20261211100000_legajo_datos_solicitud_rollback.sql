-- Rollback de 20261211100000_legajo_datos_solicitud.sql (no toca datos).
begin;
drop function if exists public.legajo_datos_solicitud(uuid);
commit;
