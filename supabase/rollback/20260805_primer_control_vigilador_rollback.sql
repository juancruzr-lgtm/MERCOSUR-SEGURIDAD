-- Rollback de 20260805120000_primer_control_vigilador.sql
--
-- ATENCIÓN: DROP TABLE destruye el historial de aceptaciones y solicitudes.
-- Requiere autorización expresa (regla del proyecto: no ejecutar DROP TABLE
-- sin consultar). Solo usar si el bloque se revierte por completo y no hay
-- datos que preservar, o después de exportar respaldo.

BEGIN;

DROP FUNCTION IF EXISTS public.aceptar_turno_planilla(uuid);
DROP FUNCTION IF EXISTS public.solicitar_modificacion_planilla(uuid, text);

DROP TABLE IF EXISTS public.solicitudes_modificacion_planilla;
DROP TABLE IF EXISTS public.aceptaciones_planilla;

COMMIT;
