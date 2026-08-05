-- Rollback de 20260806100000_servicios_objetivo_puesto_id.sql
-- DROP COLUMN requiere autorización expresa (regla del proyecto).

BEGIN;

DROP TRIGGER IF EXISTS trg_validar_puesto_servicio ON public.servicios_objetivo;
DROP FUNCTION IF EXISTS public.validar_puesto_servicio();
DROP INDEX IF EXISTS public.idx_servicios_objetivo_puesto;
ALTER TABLE public.servicios_objetivo DROP COLUMN IF EXISTS puesto_id;

COMMIT;
