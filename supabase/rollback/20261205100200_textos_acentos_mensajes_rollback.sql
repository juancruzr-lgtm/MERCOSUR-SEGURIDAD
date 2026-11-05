-- Rollback de 20261205100200_textos_acentos_mensajes.sql
--
-- Vuelve a dejar EXACTAMENTE la definición viva de producción del 04/11/2026
-- (pg_get_functiondef) de las tres funciones, con los mensajes sin acentos o
-- con escapes \u00f3 literales. md5(prosrc) esperado después del rollback:
--   corregir_turno_manual_operativo   eb366aa1d417ffb90edb227533ba7b99
--   corregir_registro_asistencia      fb70e0928c2fccd24e49890d3b8b0a98
--   solicitar_modificacion_planilla   137ec56119e991780a2e8731ae291632
-- Los cuerpos vivos usan LF: se normaliza el fin de línea para no depender del
-- checkout de git. `create or replace` conserva permisos y dueño.
--
-- La prueba supabase/pruebas/reconciliacion/run.mjs también usa este archivo
-- como "estado de producción" para demostrar que la migración sólo cambia
-- literales de RAISE.
begin;

-- @@VIVA corregir_turno_manual_operativo
do $do$ begin execute replace($def$
CREATE OR REPLACE FUNCTION public.corregir_turno_manual_operativo(p_operacion_id uuid, p_registro_id uuid, p_fecha date DEFAULT NULL::date, p_hora_inicio time without time zone DEFAULT NULL::time without time zone, p_hora_fin time without time zone DEFAULT NULL::time without time zone, p_objetivo_id uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'p_operacion_id es obligatorio';
  END IF;

  v_motivo_limpio := nullif(btrim(p_motivo), '');
  IF v_motivo_limpio IS NULL THEN
    RAISE EXCEPTION 'El motivo de correcci\u00f3n es obligatorio';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT u.* INTO v_usuario
  FROM public.usuarios u
  WHERE u.auth_user_id = v_uid
    AND u.estado = 'activo'
    ;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo administraci\u00f3n activa puede corregir turnos manuales';
  END IF;

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
    RAISE EXCEPTION 'Origen de cobertura no autorizado para correcci\u00f3n: %', v_registro.origen_cobertura;
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

  UPDATE public.turnos
  SET fecha       = v_fecha_nueva,
      hora_inicio = v_hora_inicio_nueva,
      hora_fin    = v_hora_fin_nueva,
      objetivo_id = v_objetivo_id_nuevo
  WHERE id = v_turno.id;

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
       'Rec\u00e1lculo por correcci\u00f3n de horario: ' || v_motivo_limpio);
  END IF;

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
$function$
$def$, E'\r\n', E'\n'); end $do$;

-- @@VIVA corregir_registro_asistencia
do $do$ begin execute replace($def$
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
    RAISE EXCEPTION 'UPDATE no afecto exactamente 1 fila';
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
$function$
$def$, E'\r\n', E'\n'); end $do$;

-- @@VIVA solicitar_modificacion_planilla
do $do$ begin execute replace($def$
CREATE OR REPLACE FUNCTION public.solicitar_modificacion_planilla(p_turno_id uuid, p_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$ DECLARE v_uid uuid; v_empleado uuid; v_turno record; v_registro record; v_fin timestamptz; v_entrada time; v_salida time; v_horas numeric; v_auto boolean := false; v_registro_id uuid; v_id uuid; BEGIN IF p_texto IS NULL OR length(btrim(p_texto)) < 3 THEN RAISE EXCEPTION 'Debe indicar que desea modificar'; END IF; v_uid := auth.uid(); IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF; SELECT id INTO v_empleado FROM public.usuarios WHERE auth_user_id = v_uid AND estado = 'activo'; IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado o inactivo'; END IF; SELECT id, fecha, hora_inicio, hora_fin, estado, guardia_id INTO v_turno FROM public.turnos WHERE id = p_turno_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Turno inexistente'; END IF; IF v_turno.estado IN ('reemplazado', 'anulado', 'cancelado') THEN RAISE EXCEPTION 'El turno no tiene obligacion'; END IF; v_fin := ((v_turno.fecha + CASE WHEN v_turno.hora_fin <= v_turno.hora_inicio THEN 1 ELSE 0 END)::text || ' ' || v_turno.hora_fin)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'; IF v_fin > now() THEN RAISE EXCEPTION 'El turno todavia no finalizo'; END IF; SELECT r.id, r.hora_entrada_real, r.hora_salida_real, r.hora_entrada_final, r.hora_salida_final, r.horas_trabajadas, r.horas_liquidables, r.cierre_automatico INTO v_registro FROM public.registros_asistencia r WHERE r.turno_id = p_turno_id AND COALESCE(r.guardia_final_id, r.guardia_id) = v_empleado AND COALESCE(r.tipo_registro, '') <> 'ausencia' AND r.cobertura_anulada_at IS NULL ORDER BY (r.horas_liquidables IS NOT NULL) DESC, (r.hora_entrada_final IS NOT NULL OR r.hora_salida_final IS NOT NULL) DESC, r.created_at DESC LIMIT 1; IF FOUND THEN v_registro_id := v_registro.id; v_entrada := COALESCE(v_registro.hora_entrada_final, v_registro.hora_entrada_real); v_salida := COALESCE(v_registro.hora_salida_final, v_registro.hora_salida_real); v_horas := COALESCE(v_registro.horas_liquidables, v_registro.horas_trabajadas); v_auto := COALESCE(v_registro.cierre_automatico, false); ELSIF v_turno.guardia_id IS DISTINCT FROM v_empleado THEN RAISE EXCEPTION 'El turno no corresponde al empleado autenticado'; END IF; SELECT id INTO v_id FROM public.solicitudes_modificacion_planilla WHERE turno_id = p_turno_id AND empleado_id = v_empleado AND estado = 'pendiente'; IF FOUND THEN RETURN jsonb_build_object('solicitud_id', v_id, 'ya_existente', true); END IF; BEGIN INSERT INTO public.solicitudes_modificacion_planilla (turno_id, empleado_id, registro_asistencia_id, auth_user_id, texto, entrada_visible, salida_visible, horas_visibles, salida_automatica) VALUES (p_turno_id, v_empleado, v_registro_id, v_uid, btrim(p_texto), v_entrada, v_salida, v_horas, v_auto) RETURNING id INTO v_id; EXCEPTION WHEN unique_violation THEN SELECT id INTO v_id FROM public.solicitudes_modificacion_planilla WHERE turno_id = p_turno_id AND empleado_id = v_empleado AND estado = 'pendiente'; RETURN jsonb_build_object('solicitud_id', v_id, 'ya_existente', true); END; RETURN jsonb_build_object('solicitud_id', v_id, 'ya_existente', false); END; $function$
$def$, E'\r\n', E'\n'); end $do$;

commit;
