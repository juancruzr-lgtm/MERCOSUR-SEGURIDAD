/*
  Columna de auditoría para backfill de horas_liquidables.
  Guarda el valor previo antes de recalcular, permitiendo rollback.
  Idempotente: ADD COLUMN IF NOT EXISTS.
*/

ALTER TABLE registros_asistencia
  ADD COLUMN IF NOT EXISTS _horas_liquidables_pre_backfill numeric(6,2);

COMMENT ON COLUMN registros_asistencia._horas_liquidables_pre_backfill IS
  'Valor de horas_liquidables antes del backfill correctivo de agosto 2026. NULL = no afectado.';
