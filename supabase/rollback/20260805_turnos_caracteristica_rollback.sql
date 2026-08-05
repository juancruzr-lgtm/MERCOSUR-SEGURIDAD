-- Rollback de 20260805100000_turnos_caracteristica.sql
--
-- Revierte constraint, NOT NULL y default. NO revierte:
--   · el backfill NULL→'normal' (comportamiento que ya asumía el frontend);
--   · la normalización cobertura_urgente→'cobertura' (3 turnos del objetivo
--     de prueba Casa Juan — autorizada el 2026-08-05, sin valor operativo);
--   · el constraint legacy (normal|cobertura_urgente|reemplazo_no_planificado)
--     no se restaura: taxonomía reemplazada por OT-01.

BEGIN;

ALTER TABLE public.turnos DROP CONSTRAINT IF EXISTS turnos_tipo_evento_check;
ALTER TABLE public.turnos ALTER COLUMN tipo_evento DROP NOT NULL;
ALTER TABLE public.turnos ALTER COLUMN tipo_evento DROP DEFAULT;

COMMIT;
