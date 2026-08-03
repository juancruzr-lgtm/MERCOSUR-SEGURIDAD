-- Rollback de 20260803240000_rpc_corregir_turno_manual_operativo.sql
--
-- NOTA: La tabla correccion_turno_manual_log conserva el historial
-- de operaciones. Si se eliminó antes de aplicar el rollback, no hay
-- pérdida operativa (la auditoría completa queda en
-- turnos_auditoria + registros_asistencia_auditoria).

DROP FUNCTION IF EXISTS public.corregir_turno_manual_operativo(uuid, uuid, date, time, time, uuid, text);

DROP POLICY IF EXISTS "admin_correccion_turno_manual_log" ON public.correccion_turno_manual_log;

DROP TABLE IF EXISTS public.correccion_turno_manual_log;
