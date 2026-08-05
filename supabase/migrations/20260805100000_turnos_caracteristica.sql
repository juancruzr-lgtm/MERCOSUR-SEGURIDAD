-- OT-01 Bloque B — Característica obligatoria del turno
--
-- Cada turno tiene exactamente una característica en turnos.tipo_evento:
--   'normal'       turno habitual del servicio
--   'cobertura'    reemplazo / cobertura de otro vigilador o necesidad operativa
--   'capacitacion' se paga al vigilador, NO se cobra al objetivo
--
-- Reutiliza la columna existente tipo_evento (hoy solo 'normal'/'cobertura'/NULL).
-- No crea columna nueva. Idempotente: puede re-ejecutarse sin efecto adicional.
--
-- REQUISITO: ejecutar primero la sección PRE de
-- supabase/verificacion/20260805_caracteristica_turno_pre_post.sql.
-- Si existe algún valor distinto de normal/cobertura/capacitacion/NULL,
-- NO aplicar y reportar (la migración aborta sola en ese caso: el CHECK falla
-- y el BEGIN/COMMIT revierte todo).

BEGIN;

-- 1. Normalizar NULL → 'normal' (comportamiento actual del frontend:
--    turno.tipo_evento || 'normal'). No toca valores no nulos.
UPDATE public.turnos
SET tipo_evento = 'normal'
WHERE tipo_evento IS NULL;

-- 2. Default y obligatoriedad.
ALTER TABLE public.turnos ALTER COLUMN tipo_evento SET DEFAULT 'normal';
ALTER TABLE public.turnos ALTER COLUMN tipo_evento SET NOT NULL;

-- 3. CHECK de valores permitidos (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.turnos'::regclass
      AND conname = 'turnos_tipo_evento_check'
  ) THEN
    ALTER TABLE public.turnos
      ADD CONSTRAINT turnos_tipo_evento_check
      CHECK (tipo_evento IN ('normal', 'cobertura', 'capacitacion'));
  END IF;
END $$;

COMMIT;
