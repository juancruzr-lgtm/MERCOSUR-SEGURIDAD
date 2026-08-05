-- Cierre definitivo Bloque C — Aceptar requiere fichaje
--
-- Un turno pasado SIN registro de asistencia no puede aceptarse: no hay
-- asistencia que aceptar. El vigilador solo puede solicitar una
-- modificación (texto libre, p. ej. "Trabajé el turno, pero no pude fichar").
--
-- Reemplaza public.aceptar_turno_planilla: si no existe registro propio del
-- empleado en el turno, la función rechaza con error explícito en lugar de
-- registrar una aceptación con snapshot vacío. El resto no cambia.
-- solicitar_modificacion_planilla NO se modifica (ya admite sin fichaje).
--
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.aceptar_turno_planilla(p_turno_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid         uuid;
  v_empleado    uuid;
  v_turno       record;
  v_registro    record;
  v_fin         timestamptz;
  v_entrada     time;
  v_salida      time;
  v_horas       numeric;
  v_auto        boolean := false;
  v_registro_id uuid;
  v_id          uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id INTO v_empleado
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado o inactivo';
  END IF;

  SELECT id, fecha, hora_inicio, hora_fin, estado, guardia_id
  INTO v_turno
  FROM public.turnos
  WHERE id = p_turno_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno inexistente';
  END IF;

  IF v_turno.estado IN ('reemplazado', 'anulado', 'cancelado') THEN
    RAISE EXCEPTION 'El turno no tiene obligacion';
  END IF;

  v_fin := ((v_turno.fecha + CASE WHEN v_turno.hora_fin <= v_turno.hora_inicio THEN 1 ELSE 0 END)::text
            || ' ' || v_turno.hora_fin)::timestamp
           AT TIME ZONE 'America/Argentina/Buenos_Aires';
  IF v_fin > now() THEN
    RAISE EXCEPTION 'El turno todavia no finalizo';
  END IF;

  SELECT r.id, r.hora_entrada_real, r.hora_salida_real,
         r.hora_entrada_final, r.hora_salida_final,
         r.horas_trabajadas, r.horas_liquidables, r.cierre_automatico
  INTO v_registro
  FROM public.registros_asistencia r
  WHERE r.turno_id = p_turno_id
    AND COALESCE(r.guardia_final_id, r.guardia_id) = v_empleado
    AND COALESCE(r.tipo_registro, '') <> 'ausencia'
    AND r.cobertura_anulada_at IS NULL
  ORDER BY (r.horas_liquidables IS NOT NULL) DESC,
           (r.hora_entrada_final IS NOT NULL OR r.hora_salida_final IS NOT NULL) DESC,
           r.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Sin fichaje: no hay asistencia que aceptar.
    IF v_turno.guardia_id IS DISTINCT FROM v_empleado THEN
      RAISE EXCEPTION 'El turno no corresponde al empleado autenticado';
    END IF;
    RAISE EXCEPTION 'El turno no tiene fichaje: solo puede solicitar una modificacion';
  END IF;

  v_registro_id := v_registro.id;
  v_entrada := COALESCE(v_registro.hora_entrada_final, v_registro.hora_entrada_real);
  v_salida  := COALESCE(v_registro.hora_salida_final,  v_registro.hora_salida_real);
  v_horas   := COALESCE(v_registro.horas_liquidables,  v_registro.horas_trabajadas);
  v_auto    := COALESCE(v_registro.cierre_automatico, false);

  INSERT INTO public.aceptaciones_planilla (
    turno_id, empleado_id, registro_asistencia_id, auth_user_id,
    entrada_visible, salida_visible, horas_visibles, salida_automatica
  ) VALUES (
    p_turno_id, v_empleado, v_registro_id, v_uid,
    v_entrada, v_salida, v_horas, v_auto
  )
  ON CONFLICT (turno_id, empleado_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.aceptaciones_planilla
    WHERE turno_id = p_turno_id AND empleado_id = v_empleado;
    RETURN jsonb_build_object('aceptacion_id', v_id, 'ya_aceptado', true);
  END IF;

  RETURN jsonb_build_object('aceptacion_id', v_id, 'ya_aceptado', false);
END;
$BODY$;
