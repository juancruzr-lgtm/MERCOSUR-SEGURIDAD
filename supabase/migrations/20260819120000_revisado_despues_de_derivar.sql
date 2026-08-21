-- revisar_primer_control: permitir marcar "revisado" despues de haber derivado
--
-- EL PROBLEMA
-- Un supervisor derivo una planilla a Administracion, se arrepintio y la marco
-- como revisada. La fila siguio en la bandeja. Lo intento de nuevo al otro dia
-- y tampoco. No lo estaba haciendo mal: habia dos cerrojos, uno de cada lado.
--
-- El de lectura se corrigio en el PR #42 (lib/bandeja-planillas): ahora manda la
-- ultima accion y no "alguna vez paso". Pero no alcanza, porque el supervisor no
-- puede GENERAR una accion mas reciente:
--
--   IF p_accion = 'revisado' THEN
--     SELECT id INTO v_id FROM revisiones_planilla WHERE ... accion = 'revisado'
--     IF FOUND THEN RETURN 'ya_aplicado'    <-- se va sin registrar nada
--
-- Como ya existia un 'revisado' viejo, la funcion contestaba "ya aplicado" sin
-- error y sin insertar. La pantalla recargaba y todo seguia igual. El revisado
-- conservaba su fecha vieja, anterior a la derivacion, asi que la fila quedaba
-- derivada para siempre.
--
-- QUE CAMBIA
-- El atajo de idempotencia se conserva —no queremos duplicar eventos cuando
-- alguien aprieta dos veces el mismo boton— pero solo mientras 'revisado' siga
-- siendo lo ultimo que paso. Si despues hubo una derivacion, un 'revisado'
-- nuevo SI se registra: es la unica forma de que el supervisor pueda cerrar la
-- fila, y deja la decision asentada con su propia fecha y su comentario.
--
-- QUE NO CAMBIA
-- Nada de liquidacion, horas ni fichajes. Ni los permisos, ni el alcance por
-- zona, ni la validacion de la observacion. No se borra ninguna fila: el
-- historial completo de acciones queda como esta.
--
-- QUEDA PENDIENTE, A PROPOSITO
-- La rama con solicitud del vigilador (p_solicitud_id IS NOT NULL) tiene la
-- misma trampa: si la solicitud quedo en 'requiere_regularizacion', marcar
-- revisado devuelve 'ya_aplicado' y no hace nada. No se toca acá porque implica
-- cambiar la maquina de estados de la solicitud, que Administracion tambien usa.
-- Merece su propia decision.

CREATE OR REPLACE FUNCTION public.revisar_primer_control(
  p_turno_id    uuid,
  p_empleado_id uuid,
  p_accion      text,
  p_comentario  text DEFAULT NULL,
  p_solicitud_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid        uuid;
  v_actor_id   uuid;
  v_actor_rol  text;
  v_solicitud  record;
  v_estado_ant text;
  v_estado_post text;
  v_id         uuid;
  v_revisado_at timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id, rol INTO v_actor_id, v_actor_rol
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin o supervisor activo';
  END IF;

  IF v_actor_rol = 'supervisor'
     AND NOT public.turno_en_alcance_supervisor(p_turno_id, v_actor_id) THEN
    RAISE EXCEPTION 'Turno fuera del alcance del supervisor';
  END IF;

  IF p_accion NOT IN ('revisado', 'observacion', 'derivar_administracion') THEN
    RAISE EXCEPTION 'Accion invalida';
  END IF;

  IF p_accion = 'observacion' AND (p_comentario IS NULL OR length(btrim(p_comentario)) < 3) THEN
    RAISE EXCEPTION 'La observacion requiere texto';
  END IF;

  PERFORM 1 FROM public.turnos WHERE id = p_turno_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno inexistente';
  END IF;

  IF p_solicitud_id IS NOT NULL THEN
    SELECT id, estado, turno_id, empleado_id INTO v_solicitud
    FROM public.solicitudes_modificacion_planilla
    WHERE id = p_solicitud_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Solicitud inexistente';
    END IF;
    IF v_solicitud.turno_id <> p_turno_id OR v_solicitud.empleado_id <> p_empleado_id THEN
      RAISE EXCEPTION 'La solicitud no corresponde al turno indicado';
    END IF;

    v_estado_ant := v_solicitud.estado;
    IF p_accion = 'revisado' THEN
      IF v_solicitud.estado = 'pendiente' THEN
        v_estado_post := 'revisada';
      ELSE
        -- Idempotente: no degrada estados posteriores ni duplica eventos
        RETURN jsonb_build_object('ya_aplicado', true, 'estado', v_solicitud.estado);
      END IF;
    ELSIF p_accion = 'derivar_administracion' THEN
      IF v_solicitud.estado IN ('pendiente', 'revisada') THEN
        v_estado_post := 'requiere_regularizacion';
      ELSIF v_solicitud.estado = 'requiere_regularizacion' THEN
        RETURN jsonb_build_object('ya_aplicado', true, 'estado', v_solicitud.estado);
      ELSE
        RAISE EXCEPTION 'La solicitud ya fue resuelta por Administracion';
      END IF;
    ELSE
      v_estado_post := v_solicitud.estado; -- observación: sin cambio de estado
    END IF;

    IF v_estado_post IS DISTINCT FROM v_estado_ant THEN
      -- Solo cambia el estado; el texto original del vigilador es intocable.
      UPDATE public.solicitudes_modificacion_planilla
      SET estado = v_estado_post
      WHERE id = p_solicitud_id;
    END IF;
  ELSIF p_accion = 'revisado' THEN
    -- Idempotencia a nivel turno, PERO solo mientras 'revisado' siga siendo lo
    -- ultimo que paso. Si despues se derivo a Administracion, el supervisor
    -- tiene que poder volver a marcarla: sin esto, derivar era irreversible.
    SELECT id, created_at INTO v_id, v_revisado_at
    FROM public.revisiones_planilla
    WHERE turno_id = p_turno_id AND empleado_id = p_empleado_id
      AND accion = 'revisado' AND solicitud_id IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND AND NOT EXISTS (
      SELECT 1
      FROM public.revisiones_planilla d
      WHERE d.turno_id = p_turno_id
        AND d.empleado_id = p_empleado_id
        AND d.accion = 'derivar_administracion'
        AND d.created_at > v_revisado_at
    ) THEN
      RETURN jsonb_build_object('ya_aplicado', true, 'revision_id', v_id);
    END IF;
  END IF;

  INSERT INTO public.revisiones_planilla (
    turno_id, empleado_id, solicitud_id, supervisor_id, auth_user_id,
    accion, comentario, estado_anterior, estado_posterior
  ) VALUES (
    p_turno_id, p_empleado_id, p_solicitud_id, v_actor_id, v_uid,
    p_accion, NULLIF(btrim(COALESCE(p_comentario, '')), ''), v_estado_ant, v_estado_post
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'revision_id', v_id,
    'estado_anterior', v_estado_ant,
    'estado_posterior', v_estado_post
  );
END;
$BODY$;

REVOKE ALL ON FUNCTION public.revisar_primer_control(uuid, uuid, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revisar_primer_control(uuid, uuid, text, text, uuid) TO authenticated;
