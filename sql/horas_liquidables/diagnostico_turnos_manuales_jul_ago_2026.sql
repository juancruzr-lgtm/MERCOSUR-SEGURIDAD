-- ════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — Registros manuales con horas_liquidables divergentes
-- Julio y Agosto 2026
--
-- Muestra registros donde horas_liquidables almacenado difiere
-- de la duración actual del turno autorizado.
--
-- NO ejecuta UPDATE. Solo lectura.
-- ════════════════════════════════════════════════════════════════════

SELECT
  r.id                        AS registro_id,
  u.nombre || ' ' || u.apellido AS empleado,
  u.cuil,
  o.nombre                    AS objetivo,
  t.fecha,
  t.hora_inicio::text || ' - ' || t.hora_fin::text AS horario_actual_turno,
  r.horas_liquidables         AS horas_almacenadas,
  ROUND(
    CASE
      WHEN t.hora_fin <= t.hora_inicio THEN
        (EXTRACT(EPOCH FROM t.hora_fin) + 86400 - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
      ELSE
        (EXTRACT(EPOCH FROM t.hora_fin) - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
    END,
    2
  )                           AS duracion_actual_autorizada,
  ROUND(
    CASE
      WHEN t.hora_fin <= t.hora_inicio THEN
        (EXTRACT(EPOCH FROM t.hora_fin) + 86400 - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
      ELSE
        (EXTRACT(EPOCH FROM t.hora_fin) - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
    END,
    2
  ) - COALESCE(r.horas_liquidables, 0) AS diferencia,
  r.origen_cobertura,
  CASE
    WHEN r.cobertura_anulada_at IS NOT NULL THEN 'SÍ (cobertura)'
    WHEN r.registro_anulado_at IS NOT NULL THEN 'SÍ (registro)'
    ELSE 'NO'
  END                         AS anulado

FROM registros_asistencia r
JOIN turnos t ON t.id = r.turno_id
JOIN usuarios u ON u.id = r.guardia_id
LEFT JOIN objetivos o ON o.id = COALESCE(r.objetivo_final_id, t.objetivo_id)

WHERE r.tipo_registro = 'carga_manual'
  AND r.registro_anulado_at IS NULL
  AND r.cobertura_anulada_at IS NULL
  AND r.origen_cobertura IN (
    'carga_supervisor', 'carga_admin',
    'confirmacion_supervisor', 'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  )
  AND t.fecha >= '2026-07-01'
  AND t.fecha <= '2026-08-31'
  AND r.horas_liquidables IS DISTINCT FROM ROUND(
    CASE
      WHEN t.hora_fin <= t.hora_inicio THEN
        (EXTRACT(EPOCH FROM t.hora_fin) + 86400 - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
      ELSE
        (EXTRACT(EPOCH FROM t.hora_fin) - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
    END,
    2
  )

ORDER BY t.fecha, u.apellido, u.nombre;
