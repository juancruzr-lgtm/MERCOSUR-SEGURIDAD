-- ══════════════════════════════════════════════════════════════════════════════
-- BACKFILL — Horas liquidables julio 2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Actualiza horas_liquidables de registros de julio 2026 que superan
-- el turno programado debido al bug (falta de LEAST en la función).
--
-- REQUISITOS PREVIOS:
--   1. Migración 20260803220000 aplicada (fix de la función).
--   2. Migración 20260803230000 aplicada (columna _horas_liquidables_pre_backfill).
--   3. Preview ejecutado y aprobado (preview_julio_2026.sql).
--
-- EXCLUYE:
--   · Registros anulados (registro_anulado_at IS NOT NULL).
--   · Coberturas anuladas (cobertura_anulada_at IS NOT NULL).
--   · Coberturas manuales válidas: origen_cobertura IN (carga_supervisor,
--     carga_admin, confirmacion_supervisor, confirmacion_admin,
--     saneamiento_historico_julio_2026). Estas fueron calculadas sin la
--     función bugueada.
--   · Registros sin diferencia (horas almacenadas = recalculadas).
--
-- AUDITORÍA:
--   · Guarda valor anterior en _horas_liquidables_pre_backfill.
--   · Inserta fila en registros_asistencia_auditoria con:
--     - campo: 'backfill_horas_fix_julio_2026'
--     - valor_anterior: horas previas
--     - valor_nuevo: horas corregidas
--     - comentario: motivo técnico
--
-- NO TOCA meses anteriores ni posteriores a julio 2026.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count integer := 0;
  v_rec   record;
  v_nuevo numeric(6,2);
BEGIN

  FOR v_rec IN
    SELECT
      r.id               AS registro_id,
      r.turno_id,
      r.horas_liquidables AS horas_antes,
      t.hora_inicio,
      t.hora_fin,
      COALESCE(r.hora_entrada_final, r.hora_entrada_real) AS entrada_eff,
      COALESCE(r.hora_salida_final,  r.hora_salida_real)  AS salida_eff
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
      AND r.horas_liquidables > calcular_horas_liquidables(
        t.hora_inicio, t.hora_fin,
        COALESCE(r.hora_entrada_final, r.hora_entrada_real),
        COALESCE(r.hora_salida_final,  r.hora_salida_real)
      )
  LOOP
    v_nuevo := calcular_horas_liquidables(
      v_rec.hora_inicio, v_rec.hora_fin,
      v_rec.entrada_eff, v_rec.salida_eff
    );

    -- Guardar valor anterior
    UPDATE registros_asistencia
    SET _horas_liquidables_pre_backfill = v_rec.horas_antes
    WHERE id = v_rec.registro_id;

    -- Aplicar corrección
    UPDATE registros_asistencia
    SET horas_liquidables = v_nuevo
    WHERE id = v_rec.registro_id;

    -- Auditoría
    INSERT INTO registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      v_rec.registro_id,
      v_rec.turno_id,
      '3a8e3c04-f4f5-48c4-8830-73edccb73667',
      'backfill_horas_fix_julio_2026',
      v_rec.horas_antes::text,
      v_nuevo::text,
      'Corrección automática: horas liquidables excedían turno programado por bug en calcular_horas_liquidables (falta LEAST). Actor: backfill técnico.'
    );

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Julio 2026: % registros corregidos', v_count;
END;
$$;
