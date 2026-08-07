-- crear_turnos_posicion_objetivo: permitir puestos doblados
--
-- Un objetivo puede necesitar MAS DE UN vigilador en la misma posicion, fecha
-- y horario: MUSEO CASTAGNINO lleva 3 en Principal los fines de semana. El
-- alta manual de turnos siempre lo permitio —avisa y ofrece "Crear de todos
-- modos"— pero la creacion desde la grilla lo rechazaba como duplicado, asi
-- que la misma operacion se podia hacer por una pantalla y por la otra no.
--
-- Se agrega p_permitir_duplicado. Por defecto false: la proteccion contra
-- duplicados accidentales al generar un rango entero sigue igual. En true, la
-- verificacion de turno equivalente no bloquea y cada fecha crea un turno mas
-- sobre los que ya haya, sin tope: tres, cuatro o los que la operacion pida.
--
-- Se hace DROP + CREATE en vez de CREATE OR REPLACE: cambiar la lista de
-- parametros generaria una segunda funcion sobrecargada y PostgREST no sabria
-- cual llamar.
--
-- Aditiva en efecto (ninguna llamada existente cambia de comportamiento),
-- reversible volviendo a la firma anterior.

DROP FUNCTION IF EXISTS public.crear_turnos_posicion_objetivo(uuid, uuid, uuid, time, time, jsonb);

CREATE OR REPLACE FUNCTION public.crear_turnos_posicion_objetivo(
  p_operacion_id      uuid,
  p_objetivo_id       uuid,
  p_puesto_id         uuid,
  p_hora_inicio       time,
  p_hora_fin          time,
  p_fechas            jsonb,
  p_permitir_duplicado boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid       uuid;
  v_actor     record;
  v_zonas     uuid[];
  v_objetivo  record;
  v_hash      text;
  v_previa    record;
  v_mes       text;
  v_payload   jsonb;
  v_fecha_txt text;
  v_fecha     date;
  v_hoy_arg   date;
  v_hora_arg  time;
  v_exist_id  uuid;
  v_turno_id  uuid;
  v_res       text;
  v_motivo    text;
  v_filas_out jsonb := '[]'::jsonb;
  v_creados   uuid[] := '{}';
  v_creadas   integer := 0;
  v_ya        integer := 0;
  v_omitidas  integer := 0;
  v_total     integer;
  v_resultado jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id, rol INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la programacion es de administracion o supervision';
  END IF;

  IF v_actor.rol = 'supervisor' THEN
    SELECT array_agg(zona_id) INTO v_zonas
    FROM public.supervisor_zonas WHERE supervisor_id = v_actor.id;
    -- v_zonas NULL = supervisor sin zonas = alcance total (regla existente).
  END IF;

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'operacion_id requerido';
  END IF;
  IF p_objetivo_id IS NULL OR p_puesto_id IS NULL THEN
    RAISE EXCEPTION 'Objetivo y posicion operativa requeridos';
  END IF;
  IF p_hora_inicio IS NULL OR p_hora_fin IS NULL THEN
    RAISE EXCEPTION 'Horario requerido';
  END IF;
  -- hora_fin < hora_inicio es un turno nocturno, valido. Iguales no definen duracion.
  IF p_hora_inicio = p_hora_fin THEN
    RAISE EXCEPTION 'El horario de fin no puede ser igual al de inicio';
  END IF;
  IF p_fechas IS NULL OR jsonb_typeof(p_fechas) <> 'array' OR jsonb_array_length(p_fechas) = 0 THEN
    RAISE EXCEPTION 'No hay fechas seleccionadas';
  END IF;
  v_total := jsonb_array_length(p_fechas);
  IF v_total > 500 THEN
    RAISE EXCEPTION 'Demasiadas fechas para una sola operacion (maximo 500)';
  END IF;

  -- Validaciones que aplican a toda la operacion: si fallan, no se crea nada.
  SELECT o.estado, o.zona_id INTO v_objetivo
  FROM public.objetivos o WHERE o.id = p_objetivo_id;
  IF NOT FOUND OR v_objetivo.estado <> 'activo' THEN
    RAISE EXCEPTION 'Objetivo inactivo';
  END IF;
  -- es_prueba no se chequea a proposito: la exclusion de objetivos de prueba
  -- aplica a la generacion masiva, no a esta accion puntual sobre un objetivo
  -- elegido a mano.
  IF v_actor.rol = 'supervisor' AND v_zonas IS NOT NULL
     AND NOT (v_objetivo.zona_id = ANY (v_zonas)) THEN
    RAISE EXCEPTION 'Objetivo fuera de la zona del supervisor';
  END IF;

  PERFORM 1 FROM public.puestos p
  WHERE p.id = p_puesto_id AND p.activo AND p.objetivo_id = p_objetivo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa inactiva o de otro objetivo';
  END IF;

  -- Idempotencia por operacion. El lock serializa reintentos concurrentes
  -- del mismo operacion_id.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));
  v_payload := jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'puesto_id', p_puesto_id,
    'hora_inicio', p_hora_inicio::text,
    'hora_fin', p_hora_fin::text,
    'fechas', p_fechas,
    'permitir_duplicado', p_permitir_duplicado
  );
  v_hash := md5(v_payload::text);
  SELECT payload_hash, resultado INTO v_previa
  FROM public.generacion_turnos_auditoria
  WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_previa.payload_hash = v_hash THEN
      RETURN v_previa.resultado || jsonb_build_object('repetida', true);
    END IF;
    RAISE EXCEPTION 'La operacion ya fue ejecutada con otro contenido: inicia una operacion nueva';
  END IF;

  v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;

  FOR v_fecha_txt IN SELECT jsonb_array_elements_text(p_fechas) LOOP
    v_res := 'omitida';
    v_motivo := NULL;
    v_turno_id := NULL;
    v_exist_id := NULL;
    BEGIN
      v_fecha := v_fecha_txt::date;

      IF v_fecha < v_hoy_arg
         OR (v_fecha = v_hoy_arg AND p_hora_inicio <= v_hora_arg) THEN
        RAISE EXCEPTION 'Fecha pasada: los dias pasados se resuelven por regularizacion administrativa';
      END IF;

      -- Turno equivalente vigente en la misma posicion, fecha y horario.
      -- Con p_permitir_duplicado no se consulta: el puesto va doblado a
      -- proposito y cada fecha suma un turno mas.
      IF NOT p_permitir_duplicado THEN
        SELECT t.id INTO v_exist_id
        FROM public.turnos t
        WHERE t.objetivo_id = p_objetivo_id
          AND t.puesto_id = p_puesto_id
          AND t.fecha = v_fecha
          AND t.hora_inicio = p_hora_inicio
          AND t.hora_fin = p_hora_fin
          AND COALESCE(t.tipo_evento, 'normal') = 'normal'
          AND COALESCE(t.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
        LIMIT 1;
      END IF;

      IF v_exist_id IS NOT NULL THEN
        v_res := 'ya_existe';
        v_motivo := 'Ya hay un turno cargado para esa posicion, fecha y horario';
        v_turno_id := v_exist_id;
      ELSE
        INSERT INTO public.turnos (
          objetivo_id, puesto_id, servicio_base_id, fecha, hora_inicio, hora_fin,
          estado, tipo_evento, estado_revision, guardia_id, guardia_original_id, guardia_real_id
        ) VALUES (
          p_objetivo_id, p_puesto_id, NULL, v_fecha,
          p_hora_inicio, p_hora_fin,
          'programado', 'normal', 'aprobado', NULL, NULL, NULL
        )
        RETURNING id INTO v_turno_id;
        v_res := 'creada';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_res := 'omitida';
      v_motivo := SQLERRM;
      v_turno_id := NULL;
    END;

    IF v_res = 'creada' THEN
      v_creadas := v_creadas + 1;
      v_creados := array_append(v_creados, v_turno_id);
    ELSIF v_res = 'ya_existe' THEN
      v_ya := v_ya + 1;
    ELSE
      v_omitidas := v_omitidas + 1;
    END IF;

    v_filas_out := v_filas_out || jsonb_build_object(
      'fecha', v_fecha_txt,
      'resultado', v_res,
      'motivo', v_motivo,
      'turno_id', v_turno_id
    );
  END LOOP;

  -- La auditoria indexa por mes: se toma el de la primera fecha del lote.
  v_mes := left(p_fechas->>0, 7);

  v_resultado := jsonb_build_object(
    'operacion_id', p_operacion_id,
    'solicitadas', v_total,
    'creadas', v_creadas,
    'ya_existentes', v_ya,
    'omitidas', v_omitidas,
    'turnos_creados', to_jsonb(v_creados),
    'filas', v_filas_out
  );

  INSERT INTO public.generacion_turnos_auditoria (
    operacion_id, usuario_id, auth_user_id, mes, payload, payload_hash,
    filas_solicitadas, filas_creadas, filas_ya_existentes, filas_omitidas,
    turnos_creados, resultado
  ) VALUES (
    p_operacion_id, v_actor.id, v_uid, v_mes, v_payload, v_hash,
    v_total, v_creadas, v_ya, v_omitidas,
    v_creados, v_resultado
  );

  RETURN v_resultado;
END;
$BODY$;

REVOKE ALL ON FUNCTION public.crear_turnos_posicion_objetivo(uuid, uuid, uuid, time, time, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_turnos_posicion_objetivo(uuid, uuid, uuid, time, time, jsonb, boolean) TO authenticated;
