-- ============================================================
-- MERCOSUR SEGURIDAD - Limpieza segura de asistencias historicas
-- ============================================================
-- Este script NO debe ejecutarse automaticamente desde la app.
-- Revisar los resultados de control y ejecutar manualmente solo con
-- confirmacion explicita del administrador.

-- 1) Backup previo
CREATE TABLE IF NOT EXISTS backup_registros_asistencia_antes_limpieza AS
SELECT *
FROM registros_asistencia;

-- 2) Consulta de control del mes operativo actual
SELECT
  u.apellido,
  u.nombre,
  COUNT(*) AS registros,
  COALESCE(SUM(r.horas_trabajadas), 0) AS horas
FROM registros_asistencia r
JOIN usuarios u ON u.id = r.guardia_id
LEFT JOIN turnos t ON t.id = r.turno_id
WHERE t.fecha >= DATE_TRUNC('month', CURRENT_DATE)
  AND t.fecha < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
GROUP BY u.apellido, u.nombre
ORDER BY horas DESC;

-- 3) Limpieza opcional de asistencias de meses anteriores.
-- Descomentar y ejecutar manualmente solo despues de validar el backup.
-- DELETE FROM registros_asistencia r
-- USING turnos t
-- WHERE r.turno_id = t.id
--   AND t.fecha < DATE_TRUNC('month', CURRENT_DATE);
