-- ============================================================================
-- LIQ3 — 000 DÍAS: valor calculado desde la planilla real + cadena de ajuste
-- ============================================================================
-- 000 = jornadas reales reconocidas para liquidación (fechas distintas
-- trabajadas; múltiples turnos el mismo día = 1 jornada). Mínimo 1 para quien
-- tiene actividad liquidable. NO se copia el mes anterior ni la programación.
-- Cadena requerida: valor CALCULADO desde planilla → ajuste humano → valor
-- ENVIADO a Visual. `dias` es el valor final/editable (lo que se manda);
-- `dias_calculado` conserva el valor derivado de la planilla.
-- Socios/administrativos sin actividad operativa NO se autocompletan (se reportan).
--
-- ROLLBACK: supabase/rollback/20260909110000_liq3_dias_calculado_rollback.sql
-- ============================================================================

alter table public.liquidacion_dias add column if not exists dias_calculado numeric;

-- 'calculado_planilla' = derivado de las jornadas reales; 'manual'/'ajustado' = editado por humano.
