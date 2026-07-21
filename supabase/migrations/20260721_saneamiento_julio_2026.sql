/*
SANEAMIENTO HISTÓRICO EXCLUSIVO PARA JULIO 2026.
Esta migración no debe reutilizarse para otros períodos.
Su único objetivo es reconstruir registros de asistencia faltantes correspondientes
al inicio de la puesta en producción del sistema.

Contexto:
  Antes de la implementación del RPC registrar_cobertura, la acción
  "confirmar_cubierto" solo actualizaba turnos.estado = 'cubierto' sin crear
  el registro de asistencia correspondiente (defecto H1).
  Esta migración corrige retroactivamente ese período.

Criterio de selección:
  - turno con fecha entre 2026-07-01 y 2026-07-31 (inclusive)
  - estado = 'cubierto'
  - guardia_id IS NOT NULL
  - no existe ningún registro de asistencia válido para ese turno
    (se ignoran únicamente los de tipo 'ausencia')

Registros creados:
  - hora_entrada_real    = NULL (no observada; no se inventa GPS)
  - hora_salida_real     = NULL (no observada; no se inventa GPS)
  - horas_trabajadas     = NULL (no calculable sin tiempos reales)
  - horas_liquidables    = duración programada del turno (exacta por turno;
                           soporta turnos de 5h, 6h, 7h, 7.5h, 8h, 8.5h,
                           9h, 10h, 11.5h, 12h, 12.5h, 14h, 16h, etc.)
  - tipo_registro        = 'carga_manual' (por compatibilidad con UI actual)
  - origen_cobertura     = 'saneamiento_historico_julio_2026'
  - observacion          = mensaje descriptivo

Cálculo de duración programada:
  NO se usa time + INTERVAL '24 hours' — PostgreSQL envuelve ese resultado
  módulo 24 produciendo valores negativos en turnos nocturnos.
  Se usa EXTRACT(EPOCH FROM hora) que devuelve segundos desde medianoche
  sin wrap-around, luego se suma 86400 para turnos nocturnos.

Idempotencia:
  La condición NOT EXISTS garantiza que no se crean duplicados si la
  migración se ejecuta más de una vez.

Auditoría prevista en la fase de diseño: 93 turnos (al 2026-07-21).
  La migración no depende de ese número fijo; inserta los que encuentre
  al ejecutarse.
*/

-- ── Conteo informativo previo ─────────────────────────────────────────────
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.turnos t
  WHERE t.fecha  >= '2026-07-01'
    AND t.fecha  <= '2026-07-31'
    AND t.estado  = 'cubierto'
    AND t.guardia_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.registros_asistencia ra
      WHERE ra.turno_id      = t.id
        AND (ra.tipo_registro IS NULL OR ra.tipo_registro <> 'ausencia')
    );
  RAISE NOTICE 'Turnos a sanear: %', v_count;
END;
$$;

-- ── Inserción idempotente ─────────────────────────────────────────────────
INSERT INTO public.registros_asistencia (
  turno_id,
  guardia_id,
  hora_entrada_real,
  hora_salida_real,
  horas_trabajadas,
  horas_liquidables,
  tipo_registro,
  origen_cobertura,
  observacion
)
SELECT
  t.id                               AS turno_id,
  t.guardia_id                       AS guardia_id,
  NULL                               AS hora_entrada_real,
  NULL                               AS hora_salida_real,
  NULL                               AS horas_trabajadas,
  -- Duración programada exacta del turno, con soporte nocturno correcto.
  -- Se usa EXTRACT(EPOCH FROM hora) para evitar wrap-around.
  ROUND(
    CASE
      WHEN t.hora_fin <= t.hora_inicio THEN
        -- Nocturno: fin está en el día siguiente
        (EXTRACT(EPOCH FROM t.hora_fin) + 86400 - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
      ELSE
        -- Diurno
        (EXTRACT(EPOCH FROM t.hora_fin) - EXTRACT(EPOCH FROM t.hora_inicio)) / 3600.0
    END,
    2
  )                                  AS horas_liquidables,
  'carga_manual'                     AS tipo_registro,
  'saneamiento_historico_julio_2026' AS origen_cobertura,
  'Cobertura confirmada desde alertas durante julio 2026; registro generado por saneamiento histórico'
                                     AS observacion
FROM public.turnos t
WHERE t.fecha  >= '2026-07-01'
  AND t.fecha  <= '2026-07-31'
  AND t.estado  = 'cubierto'
  AND t.guardia_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.registros_asistencia ra
    WHERE ra.turno_id      = t.id
      AND (ra.tipo_registro IS NULL OR ra.tipo_registro <> 'ausencia')
  );

-- ── Comprobación post-inserción ───────────────────────────────────────────
DO $$
DECLARE
  v_creados   int;
  v_negativos int;
BEGIN
  SELECT COUNT(*) INTO v_creados
  FROM public.registros_asistencia
  WHERE origen_cobertura = 'saneamiento_historico_julio_2026';

  SELECT COUNT(*) INTO v_negativos
  FROM public.registros_asistencia
  WHERE origen_cobertura = 'saneamiento_historico_julio_2026'
    AND horas_liquidables < 0;

  RAISE NOTICE 'Registros creados por saneamiento: %', v_creados;
  RAISE NOTICE 'Registros con horas_liquidables < 0 (debe ser 0): %', v_negativos;

  IF v_negativos > 0 THEN
    RAISE EXCEPTION 'ERROR: se detectaron % registros con horas_liquidables negativas. Rollback.', v_negativos;
  END IF;
END;
$$;
