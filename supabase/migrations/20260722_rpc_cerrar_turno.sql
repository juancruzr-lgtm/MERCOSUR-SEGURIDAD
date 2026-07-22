-- ════════════════════════════════════════════════════════════════════
-- 20260722_rpc_cerrar_turno.sql
--
-- RPC atómica para el cierre definitivo de un turno por supervisor/admin.
--
-- CONCEPTO:
--   El supervisor especifica los tramos de cobertura real: quién trabajó
--   y en qué horario. El sistema calcula las horas liquidables con aritmética
--   pura (sin tolerancia GPS) sobre los tiempos aprobados por el supervisor.
--
-- GARANTÍAS:
--   · Todo el trabajo ocurre en una sola transacción PG.
--   · Registros GPS existentes para guardias aprobados → UPDATE _final fields.
--   · Guardias en tramos sin registro GPS previo → INSERT nuevo registro.
--   · Registros GPS de guardias NO incluidos en tramos → horas_liquidables = 0
--     (evidencia GPS inmutable, solo se invalida la liquidación).
--   · turnos.revisado_por y revisado_at se escriben al final.
--   · Un supervisor no puede re-revisar un turno ya revisado (admin sí puede).
--   · Supervisor: solo puede cerrar turnos de objetivos en su zona asignada.
--
-- CÁLCULO DE HORAS:
--   Aritmética pura sobre los tiempos aprobados por el supervisor.
--   Sin tolerancia GPS: si el supervisor aprueba 18:00-08:00, se liquidan 14h.
--   Soporta turnos nocturnos (hora_fin < hora_inicio → cruza medianoche).
--
-- FIRMA:
--   p_turno_id   uuid   — turno a cerrar
--   p_tramos     jsonb  — array de {guardia_id, hora_inicio, hora_fin}
--                         puede ser [] para registrar turno descubierto
--   p_comentario text   — nullable; se aplica a todos los registros del cierre
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cerrar_turno(
  p_turno_id   uuid,
  p_tramos     jsonb,
  p_comentario text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid                uuid;
  v_usuario_id         uuid;
  v_rol                text;
  v_turno_hora_inicio  time;
  v_turno_hora_fin     time;
  v_turno_revisado_por uuid;
  v_tramo              jsonb;
  v_guardia_id         uuid;
  v_hora_inicio        time;
  v_hora_fin           time;
  v_minutos            int;
  v_horas              numeric;
  v_registro_id        uuid;
  v_guardias_aprobados uuid[] := ARRAY[]::uuid[];
  v_rows               int;
BEGIN

  -- ── 1. Verificar sesión ──────────────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

  -- ── 2. Verificar rol ─────────────────────────────────────────────────────
  SELECT id, rol
  INTO v_usuario_id, v_rol
  FROM public.usuarios
  WHERE auth_user_id = v_uid
    AND estado       = 'activo'
    AND rol          IN ('admin', 'supervisor');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin o supervisor con estado activo';
  END IF;

  -- ── 3. Bloquear y leer turno ─────────────────────────────────────────────
  SELECT hora_inicio, hora_fin, revisado_por
  INTO v_turno_hora_inicio, v_turno_hora_fin, v_turno_revisado_por
  FROM public.turnos
  WHERE id = p_turno_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno no encontrado: %', p_turno_id;
  END IF;

  -- ── 4. Supervisor no puede re-revisar (admin sí) ─────────────────────────
  IF v_turno_revisado_por IS NOT NULL AND v_rol <> 'admin' THEN
    RAISE EXCEPTION 'El turno ya fue revisado. Solo un administrador puede volver a cerrarlo.';
  END IF;

  -- ── 5. Supervisor: verificar que el turno pertenece a su zona ────────────
  IF v_rol = 'supervisor' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.turnos t2
      JOIN public.objetivos o ON o.id = t2.objetivo_id
      JOIN public.supervisor_zonas sz ON sz.zona_id = o.zona_id
      WHERE t2.id = p_turno_id
        AND sz.supervisor_id = v_usuario_id
    ) THEN
      RAISE EXCEPTION 'No autorizado: el turno no pertenece a su zona asignada';
    END IF;
  END IF;

  -- ── 6. Procesar cada tramo ───────────────────────────────────────────────
  FOR v_tramo IN SELECT * FROM jsonb_array_elements(p_tramos) LOOP

    v_guardia_id  := (v_tramo->>'guardia_id')::uuid;
    v_hora_inicio := (v_tramo->>'hora_inicio')::time;
    v_hora_fin    := (v_tramo->>'hora_fin')::time;

    IF v_guardia_id IS NULL THEN
      RAISE EXCEPTION 'Cada tramo debe tener guardia_id';
    END IF;
    IF v_hora_inicio IS NULL OR v_hora_fin IS NULL THEN
      RAISE EXCEPTION 'Cada tramo debe tener hora_inicio y hora_fin';
    END IF;
    IF v_hora_inicio = v_hora_fin THEN
      RAISE EXCEPTION 'hora_inicio y hora_fin no pueden ser iguales en el mismo tramo';
    END IF;

    -- Aritmética pura de horas (sin tolerancia GPS)
    -- Soporta turnos nocturnos: si fin < inicio → cruza medianoche
    v_minutos := (EXTRACT(EPOCH FROM v_hora_fin)::int / 60)
               - (EXTRACT(EPOCH FROM v_hora_inicio)::int / 60);
    IF v_minutos <= 0 THEN
      v_minutos := v_minutos + 1440;
    END IF;
    v_horas := ROUND(v_minutos::numeric / 60.0, 2);

    -- Acumular guardias aprobados para el paso 7
    v_guardias_aprobados := v_guardias_aprobados || v_guardia_id;

    -- Verificar que el guardia existe
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_guardia_id) THEN
      RAISE EXCEPTION 'Guardia no encontrado: %', v_guardia_id;
    END IF;

    -- Buscar registro existente para este guardia en este turno
    -- Prioridad: mismo scoring que TypeScript (horas_liquidables > _final fields > GPS > nada)
    SELECT id INTO v_registro_id
    FROM public.registros_asistencia
    WHERE turno_id = p_turno_id
      AND COALESCE(guardia_final_id, guardia_id) = v_guardia_id
      AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia')
    ORDER BY
      (CASE WHEN horas_liquidables IS NOT NULL THEN 100 ELSE 0 END) +
      (CASE WHEN hora_entrada_final IS NOT NULL OR hora_salida_final IS NOT NULL THEN 40 ELSE 0 END) +
      (CASE WHEN hora_entrada_real IS NOT NULL THEN 10 ELSE 0 END) +
      (CASE WHEN hora_salida_real IS NOT NULL THEN 5 ELSE 0 END) DESC,
      created_at ASC
    LIMIT 1;

    IF FOUND THEN
      -- Registro existente → actualizar campos _final
      UPDATE public.registros_asistencia
      SET hora_entrada_final = v_hora_inicio,
          hora_salida_final  = v_hora_fin,
          horas_liquidables  = v_horas,
          comentario_final   = p_comentario,
          origen_cobertura   = 'confirmacion_supervisor'
      WHERE id = v_registro_id;

      INSERT INTO public.registros_asistencia_auditoria
        (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      VALUES
        (v_registro_id, p_turno_id, v_usuario_id,
         'cerrar_turno', NULL, v_horas::text, p_comentario);

    ELSE
      -- Sin registro previo → crear uno nuevo
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
      ) VALUES (
        p_turno_id,
        v_guardia_id,
        v_hora_inicio,
        v_hora_fin,
        v_horas,
        v_horas,
        'carga_manual',
        'confirmacion_supervisor',
        p_comentario
      )
      RETURNING id INTO v_registro_id;

      INSERT INTO public.registros_asistencia_auditoria
        (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      VALUES
        (v_registro_id, p_turno_id, v_usuario_id,
         'cerrar_turno_nuevo', NULL, v_horas::text, p_comentario);
    END IF;

  END LOOP;

  -- ── 7. Invalidar registros GPS no incluidos en los tramos ────────────────
  -- Preserva hora_entrada_real / hora_salida_real (evidencia inmutable).
  -- Solo pone horas_liquidables = 0 y limpia los campos _final.
  UPDATE public.registros_asistencia
  SET horas_liquidables  = 0,
      hora_entrada_final = NULL,
      hora_salida_final  = NULL,
      comentario_final   = 'No incluido en cobertura aprobada'
  WHERE turno_id = p_turno_id
    AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia')
    AND NOT (COALESCE(guardia_final_id, guardia_id) = ANY(v_guardias_aprobados))
    AND horas_liquidables IS DISTINCT FROM 0;

  -- ── 8. Marcar turno como revisado ────────────────────────────────────────
  UPDATE public.turnos
  SET revisado_por = v_usuario_id,
      revisado_at  = now(),
      -- Solo marcar cubierto si hay tramos aprobados; si no, preservar estado
      estado = CASE
                 WHEN array_length(v_guardias_aprobados, 1) > 0 THEN 'cubierto'
                 ELSE estado
               END
  WHERE id = p_turno_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'UPDATE de turnos afectó % filas para turno %; se esperaba 1',
      v_rows, p_turno_id;
  END IF;

END;
$$;

REVOKE EXECUTE ON FUNCTION public.cerrar_turno(uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cerrar_turno(uuid, jsonb, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_turno(uuid, jsonb, text) TO authenticated;
