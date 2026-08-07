-- Programación desde la grilla del objetivo
--
-- Permite crear los turnos de UNA posición operativa para un conjunto de
-- fechas, desde el legajo del objetivo, sin pasar por la vista previa global
-- de "Generar mes" (que sigue existiendo y no se modifica: son dos caminos
-- distintos que conviven).
--
-- Como el turno no nace de un servicio configurado, servicio_base_id queda
-- NULL —igual que un turno cargado a mano— y la deduplicación se apoya en el
-- criterio que la vista previa ya usa como fallback para esos casos:
-- objetivo + puesto + fecha + horario.
--
-- Reglas (las mismas que el resto del bloque, revalidadas en servidor: la RPC
-- no confía en el plan que arma el cliente):
--   · administración o supervisión activa; un supervisor con zonas asignadas
--     solo puede programar objetivos de sus zonas (misma regla que
--     asignar_vigilador_turnos);
--   · objetivo activo; puesto activo y del objetivo. A diferencia de la
--     generacion masiva, un objetivo marcado es_prueba NO se excluye: esa
--     exclusion existe para que un objetivo de prueba no ensucie la tanda
--     global de todos los objetivos, pero aca el usuario entro a UN objetivo
--     y eligio la posicion a mano. El alta manual de turnos, la asignacion y
--     la publicacion ya funcionan sobre objetivos de prueba; este camino se
--     comporta igual;
--   · sin creación retroactiva: fecha anterior a hoy, o la de hoy con el
--     turno ya comenzado, se omite con su motivo (hora Argentina, UTC-3);
--   · un turno equivalente vigente hace que la fecha se informe como
--     'ya_existe'; los estados sin obligación (reemplazado/anulado/cancelado)
--     y las características distintas de 'normal' no ocupan el lugar;
--   · una fecha inválida se omite con su motivo, sin abortar el lote;
--   · los turnos se crean SIEMPRE sin vigilador (guardia_id NULL): la
--     asignación es un paso aparte, igual que en la generación mensual;
--   · idempotente por operacion_id y auditada en generacion_turnos_auditoria,
--     reutilizando esa tabla en vez de crear una paralela.
--
-- Aditiva, idempotente, reversible. No modifica turnos existentes ni toca
-- crear_turnos_programacion_parcial.

CREATE OR REPLACE FUNCTION public.crear_turnos_posicion_objetivo(
  p_operacion_id uuid,
  p_objetivo_id  uuid,
  p_puesto_id    uuid,
  p_hora_inicio  time,
  p_hora_fin     time,
  p_fechas       jsonb
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
  -- es_prueba no se chequea a proposito: ver el encabezado. La exclusion de
  -- objetivos de prueba aplica a la generacion masiva, no a esta accion
  -- puntual sobre un objetivo elegido a mano.
  IF v_actor.rol = 'supervisor' AND v_zonas IS NOT NULL
     AND NOT (v_objetivo.zona_id = ANY (v_zonas)) THEN
    RAISE EXCEPTION 'Objetivo fuera de la zona del supervisor';
  END IF;

  PERFORM 1 FROM public.puestos p
  WHERE p.id = p_puesto_id AND p.activo AND p.objetivo_id = p_objetivo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa inactiva o de otro objetivo';
  END IF;

  -- Idempotencia por operación. El lock serializa reintentos concurrentes
  -- del mismo operacion_id.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));
  v_payload := jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'puesto_id', p_puesto_id,
    'hora_inicio', p_hora_inicio::text,
    'hora_fin', p_hora_fin::text,
    'fechas', p_fechas
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
    BEGIN
      v_fecha := v_fecha_txt::date;

      IF v_fecha < v_hoy_arg
         OR (v_fecha = v_hoy_arg AND p_hora_inicio <= v_hora_arg) THEN
        RAISE EXCEPTION 'Fecha pasada: los dias pasados se resuelven por regularizacion administrativa';
      END IF;

      -- Turno equivalente vigente en la misma posicion, fecha y horario.
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
      IF FOUND THEN
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

  -- La auditoría indexa por mes: se toma el de la primera fecha del lote.
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

REVOKE ALL ON FUNCTION public.crear_turnos_posicion_objetivo(uuid, uuid, uuid, time, time, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_turnos_posicion_objetivo(uuid, uuid, uuid, time, time, jsonb) TO authenticated;
