-- Rollback de 20260808120000_posiciones_operativas_gestion.sql
-- DROP TABLE destruye la auditoría de posiciones: requiere autorización
-- expresa. No revierte posiciones ya creadas/editadas/eliminadas por las RPCs
-- mientras estuvieron activas (esos cambios en `puestos` quedan como están).

BEGIN;

DROP FUNCTION IF EXISTS public.eliminar_posicion_operativa(uuid, text);
DROP FUNCTION IF EXISTS public.duplicar_posicion_operativa(uuid, text);
DROP FUNCTION IF EXISTS public.editar_posicion_operativa(uuid, text, integer, text, boolean);
DROP FUNCTION IF EXISTS public.crear_posicion_operativa(uuid, text, integer, text);
DROP TABLE IF EXISTS public.puestos_auditoria;
ALTER TABLE public.puestos DROP COLUMN IF EXISTS observacion;

COMMIT;
