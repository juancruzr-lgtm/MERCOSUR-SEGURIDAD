-- Rollback de 20260807140000_asignar_vigilador_turnos.sql
-- Elimina la RPC. No revierte asignaciones ya hechas (quedan en
-- turnos.guardia_id / guardia_original_id y su historial en turnos_auditoria);
-- revertir una asignación puntual se hace desde el flujo auditado de edición.

BEGIN;

DROP FUNCTION IF EXISTS public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean);

COMMIT;
