-- ══════════════════════════════════════════════════════════════════════════════
-- PREVIEW — Horas liquidables julio 2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Solo SELECT. No modifica datos.
--
-- Requisito: la función calcular_horas_liquidables() debe estar corregida
-- (migración 20260803220000 aplicada) para que los valores "correctos"
-- reflejen el tope LEAST(real, programado).
--
-- Ejecutar ambas queries por separado.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── QUERY 1: Detalle de registros que cambiarían ─────────────────────────────

SELECT
  r.id                                                          AS registro_id,
  u.apellido || ', ' || u.nombre                                AS empleado,
  u.cuil                                                        AS cuil,
  o.nombre                                                      AS objetivo,
  t.fecha,
  t.hora_inicio || ' – ' || t.hora_fin                          AS turno_programado,
  COALESCE(r.hora_entrada_final, r.hora_entrada_real)::text     AS entrada_efectiva,
  COALESCE(r.hora_salida_final,  r.hora_salida_real)::text      AS salida_efectiva,
  r.horas_liquidables                                           AS horas_almacenadas,
  calcular_horas_liquidables(
    t.hora_inicio, t.hora_fin,
    COALESCE(r.hora_entrada_final, r.hora_entrada_real),
    COALESCE(r.hora_salida_final,  r.hora_salida_real)
  )                                                             AS horas_correctas,
  r.horas_liquidables - calcular_horas_liquidables(
    t.hora_inicio, t.hora_fin,
    COALESCE(r.hora_entrada_final, r.hora_entrada_real),
    COALESCE(r.hora_salida_final,  r.hora_salida_real)
  )                                                             AS diferencia,
  COALESCE(r.origen_cobertura, 'sin_origen')                    AS origen_registro,
  CASE
    WHEN r.hora_entrada_final IS NOT NULL
      OR r.hora_salida_final  IS NOT NULL
    THEN 'SI' ELSE 'NO'
  END                                                           AS tiene_correcciones_final,
  CASE
    WHEN r.origen_cobertura IN (
      'carga_supervisor', 'carga_admin',
      'confirmacion_supervisor', 'confirmacion_admin',
      'saneamiento_historico_julio_2026'
    ) THEN 'SI' ELSE 'NO'
  END                                                           AS es_cobertura_manual,
  CASE
    WHEN r.registro_anulado_at IS NOT NULL THEN 'ANULADO'
    WHEN r.cobertura_anulada_at IS NOT NULL THEN 'COBERTURA_ANULADA'
    ELSE 'ACTIVO'
  END                                                           AS estado_registro

FROM registros_asistencia r
JOIN turnos t ON t.id = r.turno_id
LEFT JOIN usuarios u ON u.id = COALESCE(r.guardia_final_id, r.guardia_id)
LEFT JOIN objetivos o ON o.id = COALESCE(r.objetivo_final_id, t.objetivo_id)

WHERE t.fecha >= '2026-07-01'
  AND t.fecha <= '2026-07-31'
  -- Excluir anulados
  AND r.registro_anulado_at IS NULL
  AND r.cobertura_anulada_at IS NULL
  -- Excluir coberturas manuales válidas (calculadas sin la función bugueada)
  AND (r.origen_cobertura IS NULL OR r.origen_cobertura NOT IN (
    'carga_supervisor', 'carga_admin',
    'confirmacion_supervisor', 'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  ))
  -- Solo registros con datos completos
  AND r.horas_liquidables IS NOT NULL
  AND r.horas_liquidables > 0
  AND COALESCE(r.hora_entrada_final, r.hora_entrada_real) IS NOT NULL
  AND COALESCE(r.hora_salida_final,  r.hora_salida_real)  IS NOT NULL
  -- Solo los que tienen diferencia (horas almacenadas > recalculadas)
  AND r.horas_liquidables > calcular_horas_liquidables(
    t.hora_inicio, t.hora_fin,
    COALESCE(r.hora_entrada_final, r.hora_entrada_real),
    COALESCE(r.hora_salida_final,  r.hora_salida_real)
  )

ORDER BY
  r.horas_liquidables - calcular_horas_liquidables(
    t.hora_inicio, t.hora_fin,
    COALESCE(r.hora_entrada_final, r.hora_entrada_real),
    COALESCE(r.hora_salida_final,  r.hora_salida_real)
  ) DESC;


-- ── QUERY 2: Resumen estadístico ────────────────────────────────────────────

WITH base AS (
  SELECT
    r.id,
    r.horas_liquidables AS actual,
    calcular_horas_liquidables(
      t.hora_inicio, t.hora_fin,
      COALESCE(r.hora_entrada_final, r.hora_entrada_real),
      COALESCE(r.hora_salida_final,  r.hora_salida_real)
    ) AS correcto
  FROM registros_asistencia r
  JOIN turnos t ON t.id = r.turno_id
  WHERE t.fecha >= '2026-07-01'
    AND t.fecha <= '2026-07-31'
    AND r.registro_anulado_at IS NULL
    AND r.cobertura_anulada_at IS NULL
    AND (r.origen_cobertura IS NULL OR r.origen_cobertura NOT IN (
      'carga_supervisor', 'carga_admin',
      'confirmacion_supervisor', 'confirmacion_admin',
      'saneamiento_historico_julio_2026'
    ))
    AND r.horas_liquidables IS NOT NULL
    AND r.horas_liquidables > 0
    AND COALESCE(r.hora_entrada_final, r.hora_entrada_real) IS NOT NULL
    AND COALESCE(r.hora_salida_final,  r.hora_salida_real)  IS NOT NULL
)
SELECT
  count(*)                                                  AS registros_totales,
  count(*) FILTER (WHERE actual > correcto)                 AS registros_que_cambiarian,
  ROUND(SUM(actual)::numeric, 2)                            AS horas_actuales,
  ROUND(SUM(CASE WHEN actual > correcto
              THEN correcto ELSE actual END)::numeric, 2)   AS horas_correctas,
  ROUND(SUM(CASE WHEN actual > correcto
              THEN actual - correcto ELSE 0 END)::numeric, 2) AS diferencia_total,
  count(*) FILTER (WHERE (actual - correcto) * 60 > 15)     AS diff_mayor_15min,
  count(*) FILTER (WHERE (actual - correcto) * 60 > 30)     AS diff_mayor_30min,
  count(*) FILTER (WHERE actual - correcto > 1)              AS diff_mayor_1h,
  count(*) FILTER (WHERE actual - correcto > 2)              AS diff_mayor_2h,
  count(*) FILTER (WHERE actual - correcto > 4)              AS diff_mayor_4h,
  ROUND(MAX(CASE WHEN actual > correcto
              THEN actual - correcto ELSE 0 END)::numeric, 2) AS maxima_diferencia
FROM base;
