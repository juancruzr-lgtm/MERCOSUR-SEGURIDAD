-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Horas liquidables agosto 2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Restaura horas_liquidables al valor previo al backfill, usando la columna
-- _horas_liquidables_pre_backfill.
--
-- Solo afecta registros de agosto 2026 que fueron modificados por el backfill.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count integer;
BEGIN
  UPDATE registros_asistencia r
  SET horas_liquidables = r._horas_liquidables_pre_backfill
  FROM turnos t
  WHERE t.id = r.turno_id
    AND t.fecha >= '2026-08-01'
    AND t.fecha <= '2026-08-31'
    AND r._horas_liquidables_pre_backfill IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Agosto 2026 rollback: % registros restaurados', v_count;

  UPDATE registros_asistencia r
  SET _horas_liquidables_pre_backfill = NULL
  FROM turnos t
  WHERE t.id = r.turno_id
    AND t.fecha >= '2026-08-01'
    AND t.fecha <= '2026-08-31'
    AND r._horas_liquidables_pre_backfill IS NOT NULL;
END;
$$;
