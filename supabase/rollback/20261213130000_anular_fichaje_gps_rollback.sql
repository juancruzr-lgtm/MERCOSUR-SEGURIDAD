-- Rollback de 20261213130000_anular_fichaje_gps.sql
-- Quita la RPC. Los fichajes ya anulados con ella quedan anulados (registro y
-- auditoría se conservan); para revertir uno puntual hay que hacerlo aparte,
-- con aprobación, a partir de registros_asistencia_auditoria.
begin;
drop function if exists public.anular_fichaje_gps(uuid, text);
commit;
