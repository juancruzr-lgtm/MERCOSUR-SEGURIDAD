-- Rollback de 20260805100000_turnos_caracteristica.sql
--
-- Revierte constraint, NOT NULL y default. NO revierte el backfill
-- NULL→'normal' (era el valor efectivo que ya asumía el frontend;
-- revertirlo a NULL no aporta y perdería información).

BEGIN;

ALTER TABLE public.turnos DROP CONSTRAINT IF EXISTS turnos_tipo_evento_check;
ALTER TABLE public.turnos ALTER COLUMN tipo_evento DROP NOT NULL;
ALTER TABLE public.turnos ALTER COLUMN tipo_evento DROP DEFAULT;

COMMIT;
