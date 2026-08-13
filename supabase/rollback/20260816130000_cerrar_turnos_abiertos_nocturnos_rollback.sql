-- ROLLBACK de 20260816130000_cerrar_turnos_abiertos_nocturnos.sql
--
-- Vuelve cerrar_turnos_abiertos() a la version de 20260721, la que calcula el
-- fin del turno sin sumar el dia en los nocturnos.
--
-- NO EJECUTAR SIN PAUSAR EL CRON PRIMERO. Con esta version restaurada y el job
-- 'cerrar-turnos-abiertos' activo, todo turno nocturno vuelve a cerrarse
-- apenas el vigilador ficha entrada:
--
--   select cron.unschedule('cerrar-turnos-abiertos');
--
-- Solo tiene sentido si el arreglo hubiera roto algo peor, cosa poco probable:
-- el unico cambio es la fecha de fin de los turnos que cruzan la medianoche.

CREATE OR REPLACE FUNCTION cerrar_turnos_abiertos()
RETURNS TABLE (
  registros_cerrados  integer,
  detalle             text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count  integer := 0;
BEGIN
  WITH vencidos AS (
    SELECT
      r.id                    AS registro_id,
      r.hora_entrada_final,
      r.hora_entrada_real,
      t.hora_inicio,
      t.hora_fin
    FROM registros_asistencia r
    JOIN turnos t ON t.id = r.turno_id
    WHERE r.hora_entrada_real IS NOT NULL
      AND r.hora_salida_real  IS NULL
      AND r.hora_salida_final IS NULL
      AND r.cierre_automatico  = false
      AND (t.fecha || ' ' || t.hora_fin)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'
          < (now() - interval '30 minutes')
  ),
  cerrados AS (
    UPDATE registros_asistencia ra
    SET
      hora_salida_final  = v.hora_fin,
      horas_liquidables  = calcular_horas_liquidables(
                             v.hora_inicio,
                             v.hora_fin,
                             COALESCE(ra.hora_entrada_final, ra.hora_entrada_real),
                             v.hora_fin
                           ),
      cierre_automatico  = true
    FROM vencidos v
    WHERE ra.id = v.registro_id
    RETURNING ra.id
  )
  SELECT count(*)::integer INTO v_count FROM cerrados;

  RETURN QUERY SELECT v_count, (v_count || ' registro(s) cerrado(s) automáticamente')::text;
END;
$$;
