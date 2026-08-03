-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN — Horas liquidables agosto 2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Ejecutar después del backfill para confirmar que no quedan registros
-- con horas liquidables superiores al turno programado.
--
-- Solo SELECT. No modifica datos.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── QUERY 1: Registros que aún exceden el turno programado ──────────────────
-- Debe devolver 0 filas (excluyendo coberturas manuales autorizadas).

SELECT
  r.id                                                          AS registro_id,
  u.apellido || ', ' || u.nombre                                AS empleado,
  t.fecha,
  t.hora_inicio || ' – ' || t.hora_fin                          AS turno,
  r.horas_liquidables,
  CASE
    WHEN t.hora_fin <= t.hora_inicio
      THEN ROUND(((EXTRACT(EPOCH FROM t.hora_fin)::int/60) + 1440
                 - (EXTRACT(EPOCH FROM t.hora_inicio)::int/60))::numeric / 60.0, 2)
    ELSE ROUND(((EXTRACT(EPOCH FROM t.hora_fin)::int/60)
              - (EXTRACT(EPOCH FROM t.hora_inicio)::int/60))::numeric / 60.0, 2)
  END                                                           AS horas_programadas,
  r.origen_cobertura

FROM registros_asistencia r
JOIN turnos t ON t.id = r.turno_id
LEFT JOIN usuarios u ON u.id = COALESCE(r.guardia_final_id, r.guardia_id)

WHERE t.fecha >= '2026-08-01'
  AND t.fecha <= '2026-08-31'
  AND r.registro_anulado_at IS NULL
  AND r.cobertura_anulada_at IS NULL
  AND (r.origen_cobertura IS NULL OR r.origen_cobertura NOT IN (
    'carga_supervisor', 'carga_admin',
    'confirmacion_supervisor', 'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  ))
  AND r.horas_liquidables IS NOT NULL
  AND r.horas_liquidables > CASE
    WHEN t.hora_fin <= t.hora_inicio
      THEN ROUND(((EXTRACT(EPOCH FROM t.hora_fin)::int/60) + 1440
                 - (EXTRACT(EPOCH FROM t.hora_inicio)::int/60))::numeric / 60.0, 2)
    ELSE ROUND(((EXTRACT(EPOCH FROM t.hora_fin)::int/60)
              - (EXTRACT(EPOCH FROM t.hora_inicio)::int/60))::numeric / 60.0, 2)
  END + 0.01;


-- ── QUERY 2: Resumen de auditoría del backfill ──────────────────────────────

SELECT
  count(*)                                                      AS registros_modificados,
  ROUND(SUM(r._horas_liquidables_pre_backfill - r.horas_liquidables)::numeric, 2)
                                                                AS horas_reducidas_total,
  ROUND(AVG(r._horas_liquidables_pre_backfill - r.horas_liquidables)::numeric, 2)
                                                                AS horas_reducidas_promedio,
  ROUND(MAX(r._horas_liquidables_pre_backfill - r.horas_liquidables)::numeric, 2)
                                                                AS maxima_reduccion
FROM registros_asistencia r
JOIN turnos t ON t.id = r.turno_id
WHERE t.fecha >= '2026-08-01'
  AND t.fecha <= '2026-08-31'
  AND r._horas_liquidables_pre_backfill IS NOT NULL;


-- ── QUERY 3: Coberturas manuales intactas ───────────────────────────────────

SELECT
  count(*)                                                      AS coberturas_manuales_agosto,
  count(*) FILTER (WHERE r._horas_liquidables_pre_backfill IS NOT NULL)
                                                                AS tocadas_por_backfill
FROM registros_asistencia r
JOIN turnos t ON t.id = r.turno_id
WHERE t.fecha >= '2026-08-01'
  AND t.fecha <= '2026-08-31'
  AND r.origen_cobertura IN (
    'carga_supervisor', 'carga_admin',
    'confirmacion_supervisor', 'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  )
  AND r.registro_anulado_at IS NULL;
-- tocadas_por_backfill debe ser 0
