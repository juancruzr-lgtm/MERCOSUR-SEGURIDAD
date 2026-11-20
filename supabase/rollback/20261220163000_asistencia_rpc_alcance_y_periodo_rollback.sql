-- Rollback 20261220163000_asistencia_rpc_alcance_y_periodo: vuelve EXACTAMENTE a las
-- definiciones vivas de producción leídas el 20/11/2026 (sin alcance ni período) y
-- quita el helper periodo_liquidacion_cerrado. Correr como archivo aparte, nunca junto
-- a la migración.

CREATE OR REPLACE FUNCTION public.corregir_registro_asistencia(p_registro_id uuid, p_payload jsonb, p_comentario text, p_reconocer_fuera_de_turno boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid                       uuid;
  v_modificado_por            uuid;
  v_turno_id                  uuid;
  v_hora_inicio               time;
  v_hora_fin                  time;
  v_entrada_real              time;
  v_salida_real               time;
  v_entrada_eff               time;
  v_salida_eff                time;
  v_rows                      int;
  v_before_guardia_final_id   uuid;
  v_before_objetivo_final_id  uuid;
  v_before_hora_entrada_final time;
  v_before_hora_salida_final  time;
  v_before_comentario_final   text;
  v_before_horas_liquidables  numeric;
  v_after_guardia_final_id    uuid;
  v_after_objetivo_final_id   uuid;
  v_after_hora_entrada_final  time;
  v_after_hora_salida_final   time;
  v_after_comentario_final    text;
  v_after_horas_liquidables   numeric;
  v_key                       text;
  v_allowed_keys              text[] := ARRAY[
    'guardia_final_id',
    'objetivo_final_id',
    'hora_entrada_final',
    'hora_salida_final',
    'comentario_final'
  ];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

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

  IF p_reconocer_fuera_de_turno AND COALESCE(btrim(p_comentario), '') = '' THEN
    RAISE EXCEPTION 'Reconocer un horario fuera del turno programado requiere un motivo';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'Clave no permitida en payload';
    END IF;
  END LOOP;

  SELECT
    ra.turno_id, t.hora_inicio, t.hora_fin,
    ra.hora_entrada_real, ra.hora_salida_real,
    ra.guardia_final_id, ra.objetivo_final_id,
    ra.hora_entrada_final, ra.hora_salida_final,
    ra.comentario_final, ra.horas_liquidables
  INTO
    v_turno_id, v_hora_inicio, v_hora_fin,
    v_entrada_real, v_salida_real,
    v_before_guardia_final_id, v_before_objetivo_final_id,
    v_before_hora_entrada_final, v_before_hora_salida_final,
    v_before_comentario_final, v_before_horas_liquidables
  FROM public.registros_asistencia ra
  JOIN public.turnos t ON t.id = ra.turno_id
  WHERE ra.id = p_registro_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro no encontrado o su turno no existe';
  END IF;

  IF (p_payload->>'guardia_final_id') IS NOT NULL
     AND (p_payload->>'guardia_final_id') <> ''
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = (p_payload->>'guardia_final_id')::uuid
    ) THEN
      RAISE EXCEPTION 'guardia_final_id no existe';
    END IF;
  END IF;

  IF (p_payload->>'objetivo_final_id') IS NOT NULL
     AND (p_payload->>'objetivo_final_id') <> ''
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.objetivos
      WHERE id = (p_payload->>'objetivo_final_id')::uuid
    ) THEN
      RAISE EXCEPTION 'objetivo_final_id no existe';
    END IF;
  END IF;

  v_entrada_eff := COALESCE(NULLIF(p_payload->>'hora_entrada_final', '')::time, v_entrada_real);
  v_salida_eff  := COALESCE(NULLIF(p_payload->>'hora_salida_final',  '')::time, v_salida_real);

  v_after_guardia_final_id   := NULLIF(p_payload->>'guardia_final_id',   '')::uuid;
  v_after_objetivo_final_id  := NULLIF(p_payload->>'objetivo_final_id',  '')::uuid;
  v_after_hora_entrada_final := NULLIF(p_payload->>'hora_entrada_final', '')::time;
  v_after_hora_salida_final  := NULLIF(p_payload->>'hora_salida_final',  '')::time;
  v_after_comentario_final   := NULLIF(p_payload->>'comentario_final',   '');
  v_after_horas_liquidables  := CASE
    WHEN p_reconocer_fuera_de_turno
      THEN public.calcular_horas_reconocidas(v_hora_inicio, v_hora_fin, v_entrada_eff, v_salida_eff)
      ELSE public.calcular_horas_liquidables(v_hora_inicio, v_hora_fin, v_entrada_eff, v_salida_eff)
  END;

  UPDATE public.registros_asistencia
  SET
    guardia_final_id   = v_after_guardia_final_id,
    objetivo_final_id  = v_after_objetivo_final_id,
    hora_entrada_final = v_after_hora_entrada_final,
    hora_salida_final  = v_after_hora_salida_final,
    comentario_final   = v_after_comentario_final,
    horas_liquidables  = v_after_horas_liquidables
  WHERE id = p_registro_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'UPDATE no afectó exactamente 1 fila';
  END IF;

  IF v_before_guardia_final_id IS DISTINCT FROM v_after_guardia_final_id THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'guardia_final_id',
      v_before_guardia_final_id::text, v_after_guardia_final_id::text, p_comentario);
  END IF;

  IF v_before_objetivo_final_id IS DISTINCT FROM v_after_objetivo_final_id THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'objetivo_final_id',
      v_before_objetivo_final_id::text, v_after_objetivo_final_id::text, p_comentario);
  END IF;

  IF v_before_hora_entrada_final IS DISTINCT FROM v_after_hora_entrada_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'hora_entrada_final',
      v_before_hora_entrada_final::text, v_after_hora_entrada_final::text, p_comentario);
  END IF;

  IF v_before_hora_salida_final IS DISTINCT FROM v_after_hora_salida_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'hora_salida_final',
      v_before_hora_salida_final::text, v_after_hora_salida_final::text, p_comentario);
  END IF;

  IF v_before_comentario_final IS DISTINCT FROM v_after_comentario_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'comentario_final',
      v_before_comentario_final, v_after_comentario_final, p_comentario);
  END IF;

  IF p_reconocer_fuera_de_turno THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por,
      'reconocido_fuera_de_turno', null, 'true', p_comentario);
  END IF;

  IF v_before_horas_liquidables IS DISTINCT FROM v_after_horas_liquidables THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (p_registro_id, v_turno_id, v_modificado_por, 'horas_liquidables',
      v_before_horas_liquidables::text, v_after_horas_liquidables::text, p_comentario);
  END IF;

END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobertura(p_turno_id uuid, p_guardia_id uuid, p_origen text, p_hora_entrada time without time zone DEFAULT NULL::time without time zone, p_hora_salida time without time zone DEFAULT NULL::time without time zone, p_horas_liquidables numeric DEFAULT NULL::numeric, p_comentario text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$;

drop function if exists public.periodo_liquidacion_cerrado(date);
