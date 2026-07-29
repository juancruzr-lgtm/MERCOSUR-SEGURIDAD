-- ============================================================================
-- ROLLBACK de 20260730130000_listar_ejecuciones_objetivo.sql
-- ============================================================================
-- Elimina exclusivamente la función de historial para supervisor.
-- No toca tablas, columnas, RLS, grants de tablas ni ninguna otra RPC.
-- No afecta B1 (rondas_ejecucion_detalle_supervisor) ni la RPC de en curso.
-- ============================================================================

begin;

drop function if exists public.listar_ejecuciones_objetivo(uuid, date, date);

notify pgrst, 'reload schema';

commit;
