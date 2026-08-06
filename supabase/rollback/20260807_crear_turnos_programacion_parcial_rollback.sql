-- Rollback de 20260807100000_crear_turnos_programacion_parcial.sql
-- DROP TABLE destruye la auditoría de generaciones: requiere autorización
-- expresa. Los turnos ya creados por la RPC NO se revierten acá (sus IDs
-- quedan registrados en generacion_turnos_auditoria.turnos_creados).

BEGIN;

DROP FUNCTION IF EXISTS public.crear_turnos_programacion_parcial(uuid, text, jsonb);
DROP TABLE IF EXISTS public.generacion_turnos_auditoria;

COMMIT;
