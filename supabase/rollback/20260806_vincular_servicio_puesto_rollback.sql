-- Rollback de 20260806110000_vincular_servicio_puesto.sql
-- DROP TABLE destruye la auditoría de vinculaciones: requiere autorización
-- expresa. Las vinculaciones ya aplicadas (puesto_id) no se revierten acá.

BEGIN;

DROP FUNCTION IF EXISTS public.vincular_servicio_puesto(uuid, uuid);
DROP TABLE IF EXISTS public.servicios_objetivo_auditoria;

COMMIT;
