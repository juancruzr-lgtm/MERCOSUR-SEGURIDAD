-- Rollback de 20261213140000_reactivar_turno_anulado_trabajado.sql
-- Los turnos ya reactivados quedan como están (su auditoría dice quién y por qué).
begin;
drop function if exists public.reactivar_turno_anulado_trabajado(uuid, text);
commit;
