-- Rollback de 20261208100100_accesos_invitaciones.sql
-- OJO: borra el historial de invitaciones enviadas. Exportarlo antes si tiene filas.
begin;
drop trigger if exists trg_accesos_invitaciones_inmutable on public.accesos_invitaciones;
drop function if exists public.accesos_invitaciones_inmutable();
drop table if exists public.accesos_invitaciones;
commit;
