-- ============================================================================
-- ROLLBACK de 20260801160000_listar_rondas_programadas_objetivo
-- ============================================================================
--
-- Elimina la RPC de historial por ronda programada. `listar_ejecuciones_objetivo`
-- no se había tocado, así que sigue disponible sin cambios.
--
-- CONSECUENCIA CONOCIDA de volver atrás: el Historial deja de mostrar las rondas
-- no iniciadas, pendientes y suspendidas. Si el cliente ya está desplegado con
-- la versión nueva, revertir esta migración lo deja llamando a una función
-- inexistente: revertir también el frontend (commit de la aplicación).

begin;

drop function if exists public.listar_rondas_programadas_objetivo(uuid, date, date);

notify pgrst, 'reload schema';

commit;
