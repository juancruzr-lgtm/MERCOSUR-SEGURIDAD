-- ════════════════════════════════════════════════════════════════════
-- 20260721_rpc_registrar_cobertura.sql
--
-- RPC transaccional y única vía autorizada para crear coberturas
-- manuales desde supervisor o admin.
--
-- Garantías:
--   · INSERT registro + INSERT auditoría + UPDATE turno en una sola transacción.
--   · Si cualquier paso falla, ninguno persiste.
--   · horas_liquidables = duración programada del turno (no depende de horarios reales).
--   · horas_trabajadas  = diferencia entrada-salida si ambas se proveen; NULL si no.
--   · Idempotente si ya existe un registro válido: rechaza salvo que se pase
--     p_horas_liquidables explícito (relevo parcial).
--
-- Seguridad:
--   · SECURITY DEFINER con SET search_path = public, pg_catalog.
--     Supervisor no tiene UPDATE sobre turnos vía RLS → SECURITY DEFINER necesario.
--   · auth.uid() leído internamente — nunca del frontend.
--   · p_origen validado contra lista fija; cualquier valor desconocido causa EXCEPTION.
--   · REVOKE PUBLIC; REVOKE anon; GRANT TO authenticated.
--
-- Cálculo de duración programada:
--   NO se usa time + INTERVAL '24 hours' porque PostgreSQL envuelve el resultado
--   módulo 24 (vuelve al valor original en lugar de sumar 24 h reales).
--   Se usa EXTRACT(EPOCH FROM time) que devuelve segundos desde medianoche
--   sin wrap-around, permitiendo la resta aritmética segura.
--
-- Firma:
--   p_turno_id          uuid    — turno a cubrir
--   p_guardia_id        uuid    — guardia que cubre (debe existir en usuarios)
--   p_origen            text    — origen estructurado (ver lista abajo)
--   p_hora_entrada      time    — nullable: entrada observada por supervisor
--   p_hora_salida       time    — nullable: salida observada por supervisor
--   p_horas_liquidables numeric — nullable: NULL = duración programada;
--                                explícito solo para relevos parciales
--   p_comentario        text    — nullable
--
-- Orígenes válidos:
--   carga_supervisor, carga_admin          — carga manual con tiempos observados
--   confirmacion_supervisor, confirmacion_admin — sin tiempos observados (alertas)
--   saneamiento_historico_julio_2026       — solo para el script de saneamiento
--
-- Retorna: uuid del registro creado
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_cobertura(
  p_turno_id          uuid,
  p_guardia_id        uuid,
  p_origen            text,
  p_hora_entrada      time    DEFAULT NULL,
  p_hora_salida       time    DEFAULT NULL,
  p_horas_liquidables numeric DEFAULT NULL,
  p_comentario        text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid                 uuid;
  v_modificado_por      uuid;
  v_turno_hora_inicio   time;
  v_turno_hora_fin      time;
  v_duracion_programada numeric;
  v_horas_asignadas     numeric;
  v_horas_nuevo         numeric;
  v_horas_trabajadas    numeric;
  v_registros_previos   int;
  v_registro_id         uuid;
  v_rows                int;
  v_origenes_validos    text[] := ARRAY[
    'carga_supervisor',
    'carga_admin',
    'confirmacion_supervisor',
    'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  ];
BEGIN

  -- ── 1. Verificar sesión autenticada ──────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

  -- ── 2. Verificar autorización: admin o supervisor, activo ─────────────────
  SELECT id
  INTO v_modificado_por
  FROM public.usuarios
  WHERE auth_user_id = v_uid
    AND estado       = 'activo'
    AND rol          IN ('admin', 'supervisor');

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No autorizado: se requiere rol admin o supervisor con estado activo';
  END IF;

  -- ── 3. Validar p_origen ───────────────────────────────────────────────────
  IF NOT (p_origen = ANY(v_origenes_validos)) THEN
    RAISE EXCEPTION 'Valor de p_origen no permitido: "%". Valores válidos: %',
      p_origen, array_to_string(v_origenes_validos, ', ');
  END IF;

  -- ── 4. Validar que el guardia existe ──────────────────────────────────────
  IF p_guardia_id IS NULL THEN
    RAISE EXCEPTION 'p_guardia_id no puede ser NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_guardia_id) THEN
    RAISE EXCEPTION 'Guardia no encontrado: %', p_guardia_id;
  END IF;

  -- ── 5. Bloquear el turno y leer datos programados (FOR UPDATE) ────────────
  SELECT hora_inicio, hora_fin
  INTO v_turno_hora_inicio, v_turno_hora_fin
  FROM public.turnos
  WHERE id = p_turno_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno no encontrado: %', p_turno_id;
  END IF;

  -- ── 6. Calcular duración programada (con soporte nocturno) ───────────────
  -- NOTA: se usa EXTRACT(EPOCH FROM time) para evitar el wrap-around de
  -- time + INTERVAL '24 hours' en PostgreSQL (ver comentario de archivo).
  v_duracion_programada := ROUND(
    CASE
      WHEN v_turno_hora_fin <= v_turno_hora_inicio THEN
        -- Nocturno: fin está en el día siguiente
        (EXTRACT(EPOCH FROM v_turno_hora_fin) + 86400 - EXTRACT(EPOCH FROM v_turno_hora_inicio)) / 3600.0
      ELSE
        -- Diurno
        (EXTRACT(EPOCH FROM v_turno_hora_fin) - EXTRACT(EPOCH FROM v_turno_hora_inicio)) / 3600.0
    END,
    2
  );

  -- ── 7. Calcular horas_trabajadas cuando se conocen tiempos reales ─────────
  -- Solo se registra si el supervisor proveyó entrada Y salida.
  -- Usa la misma lógica nocturna para evitar valores negativos.
  IF p_hora_entrada IS NOT NULL AND p_hora_salida IS NOT NULL THEN
    v_horas_trabajadas := ROUND(
      CASE
        WHEN p_hora_salida < p_hora_entrada THEN
          -- La salida es del día siguiente (guardia nocturno o salida después de medianoche)
          (EXTRACT(EPOCH FROM p_hora_salida) + 86400 - EXTRACT(EPOCH FROM p_hora_entrada)) / 3600.0
        ELSE
          (EXTRACT(EPOCH FROM p_hora_salida) - EXTRACT(EPOCH FROM p_hora_entrada)) / 3600.0
      END,
      2
    );
  ELSE
    v_horas_trabajadas := NULL;
  END IF;

  -- ── 8. Controlar registros previos para evitar doble conteo ──────────────
  SELECT
    COUNT(*),
    COALESCE(SUM(horas_liquidables), 0)
  INTO v_registros_previos, v_horas_asignadas
  FROM public.registros_asistencia
  WHERE turno_id      = p_turno_id
    AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia');

  IF p_horas_liquidables IS NOT NULL THEN
    -- Relevo explícito: el supervisor especificó las horas
    v_horas_nuevo := p_horas_liquidables;
  ELSIF v_registros_previos = 0 THEN
    -- Primer registro: duración programada completa
    v_horas_nuevo := v_duracion_programada;
  ELSE
    RAISE EXCEPTION
      'El turno ya tiene cobertura registrada (% horas asignadas de % programadas). '
      'Para un relevo, especificá p_horas_liquidables explícitamente.',
      v_horas_asignadas, v_duracion_programada;
  END IF;

  -- Validar que el total no supere la duración programada (con margen de 0.01 h)
  IF v_horas_asignadas + v_horas_nuevo > v_duracion_programada + 0.01 THEN
    RAISE EXCEPTION
      'Las horas liquidables (%.2f + %.2f = %.2f) superan la duración programada del turno (%.2f h).',
      v_horas_asignadas, v_horas_nuevo,
      v_horas_asignadas + v_horas_nuevo,
      v_duracion_programada;
  END IF;

  -- ── 9. INSERT en registros_asistencia ─────────────────────────────────────
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
  VALUES (
    p_turno_id,
    p_guardia_id,
    p_hora_entrada,
    p_hora_salida,
    v_horas_trabajadas,
    v_horas_nuevo,
    'carga_manual',
    p_origen,
    p_comentario
  )
  RETURNING id INTO v_registro_id;

  -- ── 10. INSERT en registros_asistencia_auditoria ──────────────────────────
  INSERT INTO public.registros_asistencia_auditoria (
    registro_id,
    turno_id,
    modificado_por,
    campo,
    valor_anterior,
    valor_nuevo,
    comentario
  )
  VALUES (
    v_registro_id,
    p_turno_id,
    v_modificado_por,
    'carga_inicial',
    NULL,
    p_origen,
    p_comentario
  );

  -- ── 11. UPDATE turnos.estado = 'cubierto' ─────────────────────────────────
  UPDATE public.turnos
  SET estado = 'cubierto'
  WHERE id = p_turno_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'UPDATE de turnos afectó % filas para turno %; se esperaba exactamente 1',
      v_rows, p_turno_id;
  END IF;

  RETURN v_registro_id;

END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobertura(uuid, uuid, text, time, time, numeric, text)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.registrar_cobertura(uuid, uuid, text, time, time, numeric, text)
  FROM anon;

GRANT EXECUTE ON FUNCTION public.registrar_cobertura(uuid, uuid, text, time, time, numeric, text)
  TO authenticated;
