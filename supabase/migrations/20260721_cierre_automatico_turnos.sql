-- Fix PROBLEMA 1: cierre automático de turnos abiertos
-- Agrega columna cierre_automatico y función cerrar_turnos_abiertos()

-- 1. Columna en registros_asistencia
ALTER TABLE registros_asistencia
  ADD COLUMN IF NOT EXISTS cierre_automatico boolean NOT NULL DEFAULT false;

-- 2. Función que cierra turnos que finalizaron sin salida registrada
--
-- Condición: hora_entrada_real IS NOT NULL  (el guardia ingresó)
--            hora_salida_real  IS NULL      (nunca fichó salida GPS)
--            hora_salida_final IS NULL      (supervisor no corrigió aún)
--            cierre_automatico = false      (no fue cerrado aún)
--            El turno terminó hace más de 30 minutos (gracia para fichajes tardíos)
--
-- Acción: pone hora_salida_final = hora_fin del turno,
--         recalcula horas_liquidables usando calcular_horas_liquidables(),
--         marca cierre_automatico = true.
--
-- Nunca modifica hora_entrada_real ni hora_salida_real (evidencia GPS inmutable).
-- Idempotente: cierre_automatico = true los excluye en ejecuciones futuras.

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
      -- Fin del turno como timestamptz en Buenos Aires, con 30 min de gracia
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
