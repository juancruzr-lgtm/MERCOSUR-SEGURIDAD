-- ============================================================================
-- ROLLBACK de 20260730120000_rondas_ejecucion_detalle_supervisor.sql
-- ============================================================================
-- Elimina exclusivamente la función de detalle para supervisor.
-- No toca tablas, columnas, RLS, grants de tablas ni ninguna otra RPC.
-- La RPC del vigilador `rondas_ejecucion_json` no se ve afectada.
-- ============================================================================

begin;

drop function if exists public.rondas_ejecucion_detalle_supervisor(uuid);

notify pgrst, 'reload schema';

commit;
