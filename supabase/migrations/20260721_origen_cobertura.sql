-- ════════════════════════════════════════════════════════════════════
-- 20260721_origen_cobertura.sql
--
-- Agrega la columna origen_cobertura a registros_asistencia.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.
-- No modifica datos existentes (backfill en migración separada de saneamiento).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.registros_asistencia
  ADD COLUMN IF NOT EXISTS origen_cobertura text;

COMMENT ON COLUMN public.registros_asistencia.origen_cobertura IS
  'Origen estructurado de la cobertura: fichaje_gps | carga_supervisor | carga_admin | '
  'confirmacion_supervisor | confirmacion_admin | confirmacion_supervisor_legacy | '
  'correccion_supervisor | correccion_admin';
