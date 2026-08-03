-- ════════════════════════════════════════════════════════════════════
-- 20260803240000_rpc_corregir_turno_manual_operativo.sql
--
-- RPC atómica para corregir turnos con registros manuales asociados.
-- Cuando se modifica el horario del turno, recalcula horas_liquidables
-- usando la nueva duración autorizada.
--
-- Garantías:
--   · Todo en una sola transacción: turno + registro + auditoría.
--   · Idempotente mediante p_operacion_id.
--   · Solo admin activo.
--   · Solo registros tipo_registro = 'carga_manual' con origen autorizado.
--   · Rechaza registros anulados.
--   · Recalcula horas_liquidables SOLO si cambió hora_inicio o hora_fin.
--   · Usa la misma lógica de duración que registrar_cobertura (soporte nocturno).
--   · Auditoría completa en turnos_auditoria y registros_asistencia_auditoria.
--
-- Firma:
--   p_operacion_id  uuid     — idempotencia (obligatorio)
--   p_registro_id   uuid     — registro manual a corregir
--   p_fecha         date     — nueva fecha (NULL = sin cambio)
--   p_hora_inicio   time     — nuevo hora_inicio (NULL = sin cambio)
--   p_hora_fin      time     — nuevo hora_fin (NULL = sin cambio)
--   p_objetivo_id   uuid     — nuevo objetivo (NULL = sin cambio)
--   p_motivo        text     — motivo obligatorio
--
-- Retorna: jsonb con turno y registro actualizados
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.corregir_turno_manual_operativo(
  p_operacion_id  uuid,
  p_registro_id   uuid,
  p_fecha         date    DEFAULT NULL,
  p_hora_inicio   time    DEFAULT NULL,
  p_hora_fin      time    DEFAULT NULL,
  p_objetivo_id   uuid    DEFAULT NULL,
  p_motivo        text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid                   uuid;
  v_usuario               public.usuarios%rowtype;
  v_turno                 public.turnos%rowtype;
  v_registro              public.registros_asistencia%rowtype;
  v_log_previo            public.correccion_turno_manual_log%rowtype;
  v_solicitud_json        jsonb;
  v_origenes_autorizados  text[] := ARRAY[
    'carga_supervisor',
    'carga_admin',
    'confirmacion_supervisor',
    'confirmacion_admin',
    'saneamiento_historico_julio_2026'
  ];
  v_cambio_horario        boolean := false;
  v_cambio_fecha          boolean := false;
  v_cambio_objetivo       boolean := false;
  v_hora_inicio_nueva     time;
  v_hora_fin_nueva        time;
  v_fecha_nueva           date;
  v_objetivo_id_nuevo     uuid;
  v_duracion_nueva        numeric;
  v_horas_antes           numeric;
  v_motivo_limpio         text;
BEGIN

  -- ── 1. Validaciones básicas ──────────────────────────────────────

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'p_operacion_id es obligatorio';
  END IF;

  v_motivo_limpio := nullif(btrim(p_motivo), '');
  IF v_motivo_limpio IS NULL THEN
    RAISE EXCEPTION 'El motivo de corrección es obligatorio';
  END IF;

  -- ── 2. Autenticación y autorización ──────────────────────────────

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT u.* INTO v_usuario
  FROM public.usuarios u
  WHERE u.auth_user_id = v_uid
    AND u.estado = 'activo'
    AND u.rol = 'admin';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo administración activa puede corregir turnos manuales';
  END IF;

  -- ── 3. Idempotencia ──────────────────────────────────────────────

  v_solicitud_json := jsonb_build_object(
    'registro_id', p_registro_id,
    'fecha', p_fecha,
    'hora_inicio', p_hora_inicio,
    'hora_fin', p_hora_fin,
    'objetivo_id', p_objetivo_id,
    'motivo', v_motivo_limpio
  );

  SELECT l.* INTO v_log_previo
  FROM public.correccion_turno_manual_log l
  WHERE l.operacion_id = p_operacion_id;

  IF FOUND THEN
    IF v_log_previo.solicitud_json IS DISTINCT FROM v_solicitud_json THEN
      RAISE EXCEPTION 'operacion_id ya utilizado con otro contexto';
    END IF;
    RETURN v_log_previo.resultado_json;
  END IF;

  -- ── 4. Bloquear registro y turno ─────────────────────────────────

  SELECT r.* INTO v_registro
  FROM public.registros_asistencia r
  WHERE r.id = p_registro_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro no encontrado: %', p_registro_id;
  END IF;

  IF v_registro.tipo_registro IS DISTINCT FROM 'carga_manual' THEN
    RAISE EXCEPTION 'Solo se pueden corregir registros manuales (tipo_registro = carga_manual). Registro actual: %', v_registro.tipo_registro;
  END IF;

  IF NOT (v_registro.origen_cobertura = ANY(v_origenes_autorizados)) THEN
    RAISE EXCEPTION 'Origen de cobertura no autorizado para corrección: %', v_registro.origen_cobertura;
  END IF;

  IF v_registro.cobertura_anulada_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede corregir una cobertura manual anulada';
  END IF;

  IF v_registro.registro_anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede corregir un registro anulado';
  END IF;

  SELECT t.* INTO v_turno
  FROM public.turnos t
  WHERE t.id = v_registro.turno_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno asociado no encontrado';
  END IF;

  IF NOT public.puede_administrar_rondas_objetivo(v_turno.objetivo_id) THEN
    RAISE EXCEPTION 'No autorizado para administrar este objetivo';
  END IF;

  -- ── 5. Determinar qué campos cambian ─────────────────────────────

  v_fecha_nueva := COALESCE(p_fecha, v_turno.fecha);
  v_hora_inicio_nueva := COALESCE(p_hora_inicio, v_turno.hora_inicio);
  v_hora_fin_nueva := COALESCE(p_hora_fin, v_turno.hora_fin);
  v_objetivo_id_nuevo := COALESCE(p_objetivo_id, v_turno.objetivo_id);

  v_cambio_fecha := (p_fecha IS NOT NULL AND p_fecha IS DISTINCT FROM v_turno.fecha);
  v_cambio_horario := (
    (p_hora_inicio IS NOT NULL AND p_hora_inicio IS DISTINCT FROM v_turno.hora_inicio) OR
    (p_hora_fin IS NOT NULL AND p_hora_fin IS DISTINCT FROM v_turno.hora_fin)
  );
  v_cambio_objetivo := (p_objetivo_id IS NOT NULL AND p_objetivo_id IS DISTINCT FROM v_turno.objetivo_id);

  IF NOT v_cambio_fecha AND NOT v_cambio_horario AND NOT v_cambio_objetivo THEN
    RAISE EXCEPTION 'No se detectaron cambios respecto al turno actual';
  END IF;

  -- ── 6. Verificar conflicto de fecha ──────────────────────────────

  IF v_cambio_fecha THEN
    IF EXISTS (
      SELECT 1
      FROM public.turnos t2
      JOIN public.registros_asistencia r2 ON r2.turno_id = t2.id
      WHERE t2.fecha = v_fecha_nueva
        AND t2.objetivo_id = v_objetivo_id_nuevo
        AND r2.guardia_id = v_registro.guardia_id
        AND r2.id <> v_registro.id
        AND r2.registro_anulado_at IS NULL
        AND r2.cobertura_anulada_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Ya existe un registro para ese guardia y objetivo en la fecha destino (%)', v_fecha_nueva;
    END IF;
  END IF;

  -- ── 7. Actualizar turno ──────────────────────────────────────────

  UPDATE public.turnos
  SET fecha       = v_fecha_nueva,
      hora_inicio = v_hora_inicio_nueva,
      hora_fin    = v_hora_fin_nueva,
      objetivo_id = v_objetivo_id_nuevo
  WHERE id = v_turno.id;

  -- ── 8. Auditoría de turno ────────────────────────────────────────

  IF v_cambio_fecha THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'fecha', v_turno.fecha::text, v_fecha_nueva::text, v_usuario.id, v_motivo_limpio);
  END IF;

  IF p_hora_inicio IS NOT NULL AND p_hora_inicio IS DISTINCT FROM v_turno.hora_inicio THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'hora_inicio', v_turno.hora_inicio::text, v_hora_inicio_nueva::text, v_usuario.id, v_motivo_limpio);
  END IF;

  IF p_hora_fin IS NOT NULL AND p_hora_fin IS DISTINCT FROM v_turno.hora_fin THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'hora_fin', v_turno.hora_fin::text, v_hora_fin_nueva::text, v_usuario.id, v_motivo_limpio);
  END IF;

  IF v_cambio_objetivo THEN
    INSERT INTO public.turnos_auditoria (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, comentario)
    VALUES (v_turno.id, 'objetivo_id', v_turno.objetivo_id::text, v_objetivo_id_nuevo::text, v_usuario.id, v_motivo_limpio);
  END IF;

  -- ── 9. Recalcular horas_liquidables si cambió horario ────────────

  IF v_cambio_horario THEN
    v_horas_antes := COALESCE(v_registro.horas_liquidables, 0);

    v_duracion_nueva := ROUND(
      CASE
        WHEN v_hora_fin_nueva <= v_hora_inicio_nueva THEN
          (EXTRACT(EPOCH FROM v_hora_fin_nueva) + 86400 - EXTRACT(EPOCH FROM v_hora_inicio_nueva)) / 3600.0
        ELSE
          (EXTRACT(EPOCH FROM v_hora_fin_nueva) - EXTRACT(EPOCH FROM v_hora_inicio_nueva)) / 3600.0
      END,
      2
    );

    UPDATE public.registros_asistencia
    SET horas_liquidables = v_duracion_nueva
    WHERE id = v_registro.id;

    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES
      (v_registro.id, v_turno.id, v_usuario.id, 'horas_liquidables',
       v_horas_antes::text, v_duracion_nueva::text,
       'Recálculo por corrección de horario: ' || v_motivo_limpio);
  END IF;

  -- ── 10. Auditoría de objetivo en registro ────────────────────────

  IF v_cambio_objetivo THEN
    UPDATE public.registros_asistencia
    SET objetivo_final_id = v_objetivo_id_nuevo
    WHERE id = v_registro.id;

    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES
      (v_registro.id, v_turno.id, v_usuario.id, 'objetivo_final_id',
       (v_registro.objetivo_final_id)::text, v_objetivo_id_nuevo::text,
       v_motivo_limpio);
  END IF;

  -- ── 11. Auditoría general ────────────────────────────────────────

  INSERT INTO public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  VALUES
    (v_registro.id, v_turno.id, v_usuario.id, 'correccion_turno_manual',
     jsonb_build_object(
       'fecha', v_turno.fecha,
       'hora_inicio', v_turno.hora_inicio,
       'hora_fin', v_turno.hora_fin,
       'objetivo_id', v_turno.objetivo_id,
       'horas_liquidables', v_registro.horas_liquidables
     )::text,
     jsonb_build_object(
       'fecha', v_fecha_nueva,
       'hora_inicio', v_hora_inicio_nueva,
       'hora_fin', v_hora_fin_nueva,
       'objetivo_id', v_objetivo_id_nuevo,
       'horas_liquidables', CASE WHEN v_cambio_horario THEN v_duracion_nueva ELSE v_registro.horas_liquidables END
     )::text,
     v_motivo_limpio);

  -- ── 12. Log de idempotencia ──────────────────────────────────────

  INSERT INTO public.correccion_turno_manual_log (
    operacion_id,
    registro_id,
    turno_id,
    ejecutado_por,
    solicitud_json,
    cambios_aplicados,
    resultado_json
  ) VALUES (
    p_operacion_id,
    v_registro.id,
    v_turno.id,
    v_usuario.id,
    v_solicitud_json,
    jsonb_build_object(
      'fecha', v_cambio_fecha,
      'horario', v_cambio_horario,
      'objetivo', v_cambio_objetivo
    ),
    jsonb_build_object(
      'estado', 'aplicado',
      'turno', jsonb_build_object(
        'id', v_turno.id,
        'fecha', v_fecha_nueva,
        'hora_inicio', v_hora_inicio_nueva,
        'hora_fin', v_hora_fin_nueva,
        'objetivo_id', v_objetivo_id_nuevo
      ),
      'registro', jsonb_build_object(
        'id', v_registro.id,
        'horas_liquidables', CASE WHEN v_cambio_horario THEN v_duracion_nueva ELSE v_registro.horas_liquidables END,
        'horas_liquidables_anterior', CASE WHEN v_cambio_horario THEN v_horas_antes ELSE NULL END
      )
    )
  );

  -- ── 13. Retornar resultado ───────────────────────────────────────

  RETURN jsonb_build_object(
    'estado', 'aplicado',
    'turno', jsonb_build_object(
      'id', v_turno.id,
      'fecha', v_fecha_nueva,
      'hora_inicio', v_hora_inicio_nueva,
      'hora_fin', v_hora_fin_nueva,
      'objetivo_id', v_objetivo_id_nuevo
    ),
    'registro', jsonb_build_object(
      'id', v_registro.id,
      'horas_liquidables', CASE WHEN v_cambio_horario THEN v_duracion_nueva ELSE v_registro.horas_liquidables END,
      'horas_liquidables_anterior', CASE WHEN v_cambio_horario THEN v_horas_antes ELSE NULL END
    )
  );

END;
$$;

-- ── Tabla de idempotencia ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.correccion_turno_manual_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id    uuid        NOT NULL UNIQUE,
  registro_id     uuid        NOT NULL,
  turno_id        uuid        NOT NULL,
  ejecutado_por   uuid        NOT NULL REFERENCES public.usuarios(id),
  solicitud_json  jsonb       NOT NULL,
  cambios_aplicados jsonb     NOT NULL,
  resultado_json  jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correccion_turno_manual_log_registro
  ON public.correccion_turno_manual_log (registro_id);

-- ── Permisos ─────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.corregir_turno_manual_operativo(uuid, uuid, date, time, time, uuid, text)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.corregir_turno_manual_operativo(uuid, uuid, date, time, time, uuid, text)
  FROM anon;

GRANT EXECUTE ON FUNCTION public.corregir_turno_manual_operativo(uuid, uuid, date, time, time, uuid, text)
  TO authenticated;

ALTER TABLE public.correccion_turno_manual_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_correccion_turno_manual_log"
  ON public.correccion_turno_manual_log
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid()
        AND u.rol = 'admin'
        AND u.estado = 'activo'
    )
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.correccion_turno_manual_log FROM anon, authenticated;
GRANT SELECT ON TABLE public.correccion_turno_manual_log TO authenticated;
