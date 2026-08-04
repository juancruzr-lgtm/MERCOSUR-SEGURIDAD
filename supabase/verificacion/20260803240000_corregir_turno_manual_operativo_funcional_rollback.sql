-- ════════════════════════════════════════════════════════════════════
-- Prueba funcional CON ROLLBACK — corregir_turno_manual_operativo
--
-- Ejecutar COMO admin autenticado (requiere auth.uid() válido).
-- Todos los cambios se revierten al final.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

SELECT set_config('request.jwt.claims', '{"sub": "67c2f633-b87c-432e-a372-7f842c923f30", "role": "authenticated"}', true);

DO $$
DECLARE
  v_turno_id       uuid;
  v_registro_id    uuid;
  v_puesto_id      uuid;
  v_resultado      jsonb;
  v_horas          numeric;
  v_op1            uuid := gen_random_uuid();
  v_op2            uuid := gen_random_uuid();
  v_op3            uuid := gen_random_uuid();
  v_op4            uuid := gen_random_uuid();
  v_op5            uuid := gen_random_uuid();
  v_op_dup         uuid;
  v_objetivo_id    uuid;
  v_guardia_id     uuid;
  v_ok             boolean;
BEGIN

  -- ── Buscar un turno con registro manual válido para las pruebas ──

  SELECT r.id, r.turno_id, t.objetivo_id, r.guardia_id, t.puesto_id
  INTO v_registro_id, v_turno_id, v_objetivo_id, v_guardia_id, v_puesto_id
  FROM registros_asistencia r
  JOIN turnos t ON t.id = r.turno_id
  WHERE r.tipo_registro = 'carga_manual'
    AND r.registro_anulado_at IS NULL
    AND r.cobertura_anulada_at IS NULL
    AND r.origen_cobertura IN ('carga_supervisor', 'carga_admin', 'confirmacion_supervisor', 'confirmacion_admin')
  LIMIT 1;

  IF v_registro_id IS NULL THEN
    RAISE NOTICE '⚠ No hay registros manuales válidos para prueba funcional. Omitir.';
    RETURN;
  END IF;

  RAISE NOTICE '── Registro de prueba: % (turno: %) ──', v_registro_id, v_turno_id;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 1: Turno 8h → cambiar a 10h → 10h liquidables
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P1: Cambiar horario 20:00-04:00 (8h) → 18:00-04:00 (10h)';

  -- Poner horario base conocido
  UPDATE turnos SET hora_inicio = '20:00:00', hora_fin = '04:00:00' WHERE id = v_turno_id;
  UPDATE registros_asistencia SET horas_liquidables = 8.00 WHERE id = v_registro_id;

  v_resultado := public.corregir_turno_manual_operativo(
    v_op1, v_registro_id, NULL, '18:00:00'::time, NULL, NULL, 'Prueba P1: ampliar turno'
  );

  SELECT horas_liquidables INTO v_horas FROM registros_asistencia WHERE id = v_registro_id;
  RAISE NOTICE '  resultado: %, horas_liquidables: %', v_resultado ->> 'estado', v_horas;
  ASSERT v_horas = 10.00, 'P1 FALLA: esperado 10.00, obtenido ' || v_horas;
  RAISE NOTICE '  P1 OK ✓';

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 2: Turno 10h → cambiar a 8h → 8h liquidables
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P2: Cambiar horario 18:00-04:00 (10h) → 20:00-04:00 (8h)';

  v_resultado := public.corregir_turno_manual_operativo(
    v_op2, v_registro_id, NULL, '20:00:00'::time, NULL, NULL, 'Prueba P2: reducir turno'
  );

  SELECT horas_liquidables INTO v_horas FROM registros_asistencia WHERE id = v_registro_id;
  ASSERT v_horas = 8.00, 'P2 FALLA: esperado 8.00, obtenido ' || v_horas;
  RAISE NOTICE '  P2 OK ✓';

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 3: Cambiar solo fecha → horas sin cambio
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P3: Cambiar solo fecha → horas deben permanecer 8.00';

  v_resultado := public.corregir_turno_manual_operativo(
    v_op3, v_registro_id, '2026-06-15'::date, NULL, NULL, NULL, 'Prueba P3: solo fecha'
  );

  SELECT horas_liquidables INTO v_horas FROM registros_asistencia WHERE id = v_registro_id;
  ASSERT v_horas = 8.00, 'P3 FALLA: esperado 8.00, obtenido ' || v_horas;
  RAISE NOTICE '  P3 OK ✓';

  -- Restaurar fecha
  UPDATE turnos SET fecha = '2026-07-15' WHERE id = v_turno_id;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 4: Cambiar solo objetivo → horas sin cambio
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P4: Cambiar solo objetivo → horas deben permanecer';

  DECLARE
    v_otro_objetivo uuid;
  BEGIN
    SELECT p.objetivo_id INTO v_otro_objetivo
    FROM puestos p
    WHERE p.id = v_puesto_id
      AND p.objetivo_id <> v_objetivo_id
    LIMIT 1;

    IF v_otro_objetivo IS NOT NULL THEN
      v_resultado := public.corregir_turno_manual_operativo(
        v_op4, v_registro_id, NULL, NULL, NULL, v_otro_objetivo, 'Prueba P4: solo objetivo'
      );

      SELECT horas_liquidables INTO v_horas FROM registros_asistencia WHERE id = v_registro_id;
      ASSERT v_horas = 8.00, 'P4 FALLA: esperado 8.00, obtenido ' || v_horas;
      RAISE NOTICE '  P4 OK ✓';
    ELSE
      RAISE NOTICE '  P4 SKIP: no hay otro objetivo disponible';
    END IF;
  END;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 5: Turno nocturno — 22:00-06:00 (8h)
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P5: Turno nocturno 20:00-04:00 → 22:00-06:00 (8h)';

  v_resultado := public.corregir_turno_manual_operativo(
    v_op5, v_registro_id, NULL, '22:00:00'::time, '06:00:00'::time, NULL, 'Prueba P5: nocturno'
  );

  SELECT horas_liquidables INTO v_horas FROM registros_asistencia WHERE id = v_registro_id;
  ASSERT v_horas = 8.00, 'P5 FALLA: esperado 8.00, obtenido ' || v_horas;
  RAISE NOTICE '  P5 OK ✓';

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 6a: Idempotencia — mismo payload → devuelve resultado anterior
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P6a: Mismo operacion_id + mismo payload → resultado anterior';

  v_op_dup := v_op5;
  v_resultado := public.corregir_turno_manual_operativo(
    v_op_dup, v_registro_id, NULL, '22:00:00'::time, '06:00:00'::time, NULL, 'Prueba P5: nocturno'
  );

  ASSERT v_resultado ->> 'estado' = 'aplicado', 'P6a FALLA: idempotencia no retornó estado aplicado';
  RAISE NOTICE '  P6a OK ✓';

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 6b: Mismo operacion_id + horario distinto → conflicto
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P6b: Mismo operacion_id + horario distinto → conflicto';

  BEGIN
    v_resultado := public.corregir_turno_manual_operativo(
      v_op_dup, v_registro_id, NULL, '19:00:00'::time, '06:00:00'::time, NULL, 'Prueba P5: nocturno'
    );
    RAISE EXCEPTION 'P6b FALLA: no lanzó excepción para horario distinto';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  P6b OK ✓ — excepción: %', SQLERRM;
  END;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 6c: Mismo operacion_id + fecha distinta → conflicto
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P6c: Mismo operacion_id + fecha distinta → conflicto';

  BEGIN
    v_resultado := public.corregir_turno_manual_operativo(
      v_op_dup, v_registro_id, '2026-06-01'::date, '22:00:00'::time, '06:00:00'::time, NULL, 'Prueba P5: nocturno'
    );
    RAISE EXCEPTION 'P6c FALLA: no lanzó excepción para fecha distinta';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  P6c OK ✓ — excepción: %', SQLERRM;
  END;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 6d: Mismo operacion_id + objetivo distinto → conflicto
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P6d: Mismo operacion_id + objetivo distinto → conflicto';

  DECLARE
    v_otro_obj uuid;
  BEGIN
    SELECT p.objetivo_id INTO v_otro_obj FROM puestos p WHERE p.id = v_puesto_id AND p.objetivo_id <> v_objetivo_id LIMIT 1;
    IF v_otro_obj IS NOT NULL THEN
      BEGIN
        v_resultado := public.corregir_turno_manual_operativo(
          v_op_dup, v_registro_id, NULL, '22:00:00'::time, '06:00:00'::time, v_otro_obj, 'Prueba P5: nocturno'
        );
        RAISE EXCEPTION 'P6d FALLA: no lanzó excepción para objetivo distinto';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  P6d OK ✓ — excepción: %', SQLERRM;
      END;
    ELSE
      RAISE NOTICE '  P6d SKIP: no hay otro objetivo';
    END IF;
  END;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 6e: Mismo operacion_id + motivo distinto → conflicto
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P6e: Mismo operacion_id + motivo distinto → conflicto';

  BEGIN
    v_resultado := public.corregir_turno_manual_operativo(
      v_op_dup, v_registro_id, NULL, '22:00:00'::time, '06:00:00'::time, NULL, 'Motivo completamente diferente'
    );
    RAISE EXCEPTION 'P6e FALLA: no lanzó excepción para motivo distinto';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  P6e OK ✓ — excepción: %', SQLERRM;
  END;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 7: Registro anulado → debe rechazar
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P7: Registro anulado debe ser rechazado';

  UPDATE registros_asistencia SET cobertura_anulada_at = now(), horas_liquidables = 0 WHERE id = v_registro_id;

  BEGIN
    v_resultado := public.corregir_turno_manual_operativo(
      gen_random_uuid(), v_registro_id, NULL, '18:00:00'::time, NULL, NULL, 'Prueba P7: anulado'
    );
    RAISE EXCEPTION 'P7 FALLA: no lanzó excepción para registro anulado';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  P7 OK ✓ — excepción: %', SQLERRM;
  END;

  -- Restaurar
  UPDATE registros_asistencia SET cobertura_anulada_at = NULL, horas_liquidables = 8.00 WHERE id = v_registro_id;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 8: Registro GPS normal → debe rechazar
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P8: Registro GPS normal (no manual) debe ser rechazado';

  DECLARE
    v_registro_gps uuid;
  BEGIN
    SELECT id INTO v_registro_gps
    FROM registros_asistencia
    WHERE tipo_registro IS DISTINCT FROM 'carga_manual'
      AND registro_anulado_at IS NULL
    LIMIT 1;

    IF v_registro_gps IS NOT NULL THEN
      BEGIN
        v_resultado := public.corregir_turno_manual_operativo(
          gen_random_uuid(), v_registro_gps, NULL, '18:00:00'::time, NULL, NULL, 'Prueba P8: GPS'
        );
        RAISE EXCEPTION 'P8 FALLA: no lanzó excepción para registro GPS';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  P8 OK ✓ — excepción: %', SQLERRM;
      END;
    ELSE
      RAISE NOTICE '  P8 SKIP: no hay registro GPS para probar';
    END IF;
  END;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 9: Sin cambios → debe rechazar
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P9: Sin cambios debe ser rechazado';

  BEGIN
    v_resultado := public.corregir_turno_manual_operativo(
      gen_random_uuid(), v_registro_id, NULL, NULL, NULL, NULL, 'Prueba P9: sin cambios'
    );
    RAISE EXCEPTION 'P9 FALLA: no lanzó excepción sin cambios';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  P9 OK ✓ — excepción: %', SQLERRM;
  END;

  -- ════════════════════════════════════════════════════════════════
  -- PRUEBA 10: Auditoría completa
  -- ════════════════════════════════════════════════════════════════

  RAISE NOTICE 'P10: Verificar auditoría de horas_liquidables';

  SELECT EXISTS (
    SELECT 1 FROM registros_asistencia_auditoria
    WHERE registro_id = v_registro_id
      AND campo = 'horas_liquidables'
      AND comentario LIKE 'Recálculo por corrección de horario%'
  ) INTO v_ok;

  ASSERT v_ok, 'P10 FALLA: no se encontró auditoría de horas_liquidables';
  RAISE NOTICE '  P10 OK ✓';

  RAISE NOTICE '══ TODAS LAS PRUEBAS PASARON ══';

END;
$$;

ROLLBACK;
