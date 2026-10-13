-- Rollback de 20261016120000_habilitacion_confirmar_credencial.sql.
-- Las credenciales ya confirmadas siguen verificadas (no se deshace la verificación).
begin;
drop function if exists public.habilitacion_confirmar_credencial(uuid, text, text, date, date);
notify pgrst, 'reload schema';
commit;
