-- OT-01 Bloque B — Característica obligatoria del turno
-- APLICADA EN PRODUCCIÓN: 2026-08-05 (SQL editor, rol postgres)
--
-- Cada turno tiene exactamente una característica en turnos.tipo_evento:
--   'normal'       turno habitual del servicio
--   'cobertura'    reemplazo / cobertura de otro vigilador o necesidad operativa
--   'capacitacion' se paga al vigilador, NO se cobra al objetivo
--
-- Hallazgos del PRE (2026-08-05):
--   · normal: 3673 · cobertura_urgente: 3 · NULL: 0
--   · Los 3 'cobertura_urgente' pertenecían al objetivo de prueba "Casa Juan"
--     (es_prueba = true). Autorizada su normalización a 'cobertura'.
--   · Existía un constraint legacy turnos_tipo_evento_check con valores
--     (normal | cobertura_urgente | reemplazo_no_planificado): se reemplaza.
--
-- Idempotente: puede re-ejecutarse sin efecto adicional.

BEGIN;

-- 1. Quitar el constraint legacy ANTES de normalizar (permitía
--    'cobertura_urgente' pero no 'cobertura').
ALTER TABLE public.turnos DROP CONSTRAINT IF EXISTS turnos_tipo_evento_check;

-- 2. Normalizar valores legacy y NULL (3 filas afectadas en producción).
UPDATE public.turnos SET tipo_evento = 'cobertura' WHERE tipo_evento = 'cobertura_urgente';
UPDATE public.turnos SET tipo_evento = 'normal' WHERE tipo_evento IS NULL;

-- 3. Default y obligatoriedad.
ALTER TABLE public.turnos ALTER COLUMN tipo_evento SET DEFAULT 'normal';
ALTER TABLE public.turnos ALTER COLUMN tipo_evento SET NOT NULL;

-- 4. CHECK con la taxonomía aprobada.
ALTER TABLE public.turnos
  ADD CONSTRAINT turnos_tipo_evento_check
  CHECK (tipo_evento IN ('normal', 'cobertura', 'capacitacion'));

COMMIT;
