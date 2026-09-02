-- Completar mes para supervisores: alcance por zona, todo-o-nada
--
-- El supervisor puede completar la programación mensual de los objetivos de
-- SUS zonas desde la grilla del objetivo. La autorización vive acá, en la
-- RPC — nunca en el cliente:
--
--   · admin activo: igual que siempre, todos los objetivos válidos;
--   · supervisor activo: TODAS las filas del payload deben ser de servicios
--     existentes cuyos objetivos estén activos, no sean de prueba y
--     pertenezcan a una zona asignada en supervisor_zonas. Una sola fila
--     fuera del alcance lanza excepción ANTES de crear nada: la transacción
--     entera se revierte y no queda creación parcial;
--   · supervisor sin zonas asignadas: rechazado. (Más estricto que
--     crear_turnos_posicion_objetivo, donde "sin zonas" es alcance total:
--     decisión explícita del dueño para la creación mensual.)
--
-- Reutiliza la infraestructura existente de zonas (supervisor_zonas +
-- objetivos.zona_id, el mismo modelo que crear_turnos_posicion_objetivo,
-- anular_turnos_lote y publicar_turnos_programacion). No crea tablas ni
-- conceptos nuevos.
--
-- Las validaciones POR FILA de siempre (fecha pasada, servicio inactivo,
-- duplicado, día fuera del servicio…) no cambian: siguen omitiendo la fila
-- sin abortar el lote, que es el diseño del generador. Lo que es todo-o-nada
-- es el ALCANCE: la autorización no es un motivo de omisión, es un rechazo.
--
-- La auditoría existente (generacion_turnos_auditoria) ya registra quién
-- (usuario_id/auth_user_id), cuándo (created_at), qué payload y cuántos
-- turnos: sirve igual para el supervisor, sin cambios de esquema.
--
-- CREATE OR REPLACE con la MISMA firma y los mismos grants.

CREATE OR REPLACE FUNCTION public.crear_turnos_programacion_parcial(
  p_operacion_id uuid,
  p_mes          text,
  p_filas        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid        uuid;
  v_actor      record;
  v_zonas      uuid[];
  v_fuera      integer;
  v_hash       text;
  v_previa     record;
  v_fila       jsonb;
  v_servicio   record;
  v_objetivo   record;
  v_tb         record;
  v_exist      record;
  v_fecha      date;
  v_desde      date;
  v_hasta      date;
  v_hoy_arg    date;
  v_hora_arg   time;
  v_dow        integer;
  v_turno_id   uuid;
  v_res        text;
  v_motivo     text;
  v_filas_out  jsonb := '[]'::jsonb;
  v_creados    uuid[] := '{}';
  v_creadas    integer := 0;
  v_ya         integer := 0;
  v_omitidas   integer := 0;
  v_resultado  jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id, rol INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la generacion de turnos es de administracion o supervision';
  END IF;

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'operacion_id requerido';
  END IF;
  IF p_mes IS NULL OR p_mes !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Mes invalido (formato esperado YYYY-MM)';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'No hay filas seleccionadas';
  END IF;
  IF jsonb_array_length(p_filas) > 500 THEN
    RAISE EXCEPTION 'Demasiadas filas para una sola operacion (maximo 500)';
  END IF;

  -- Alcance del supervisor: se valida el payload COMPLETO antes de tocar
  -- nada. Cualquier fila fuera (servicio inexistente, objetivo inactivo o de
  -- prueba, zona ajena o sin zona) lanza excepcion y revierte todo: cero
  -- creaciones parciales. No se confia en ningun dato del cliente: el
  -- objetivo y su zona se derivan del servicio en la base.
  IF v_actor.rol = 'supervisor' THEN
    SELECT array_agg(zona_id) INTO v_zonas
    FROM public.supervisor_zonas WHERE supervisor_id = v_actor.id;
    IF v_zonas IS NULL THEN
      RAISE EXCEPTION 'No autorizado: supervisor sin zonas asignadas';
    END IF;

    SELECT count(*) INTO v_fuera
    FROM (
      SELECT DISTINCT (f->>'servicio_id')::uuid AS sid
      FROM jsonb_array_elements(p_filas) f
    ) x
    LEFT JOIN public.servicios_objetivo s ON s.id = x.sid
    LEFT JOIN public.objetivos o ON o.id = s.objetivo_id
    WHERE s.id IS NULL
       OR o.id IS NULL
       OR o.estado <> 'activo'
       OR COALESCE(o.es_prueba, false)
       OR o.zona_id IS NULL
       OR NOT (o.zona_id = ANY (v_zonas));
    IF v_fuera > 0 THEN
      RAISE EXCEPTION 'No autorizado: % fila(s) de objetivos fuera del alcance del supervisor; no se creo ningun turno', v_fuera;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));
  v_hash := md5(p_mes || '|' || p_filas::text);
  SELECT payload_hash, resultado INTO v_previa
  FROM public.generacion_turnos_auditoria
  WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_previa.payload_hash = v_hash THEN
      RETURN v_previa.resultado || jsonb_build_object('repetida', true);
    END IF;
    RAISE EXCEPTION 'La operacion ya fue ejecutada con otro contenido: inicia una operacion nueva';
  END IF;

  v_desde := to_date(p_mes || '-01', 'YYYY-MM-DD');
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  -- Hora Argentina (UTC-3 fija, misma convención que lib/revision-operativa).
  v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;

  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    v_res := 'omitida';
    v_motivo := NULL;
    v_turno_id := NULL;
    BEGIN
      v_fecha := (v_fila->>'fecha')::date;
      IF v_fecha IS NULL THEN
        RAISE EXCEPTION 'Fila sin fecha';
      END IF;
      IF v_fecha < v_desde OR v_fecha > v_hasta THEN
        RAISE EXCEPTION 'Fecha fuera del mes de la operacion';
      END IF;

      SELECT s.id, s.objetivo_id, s.puesto_id, s.turno_base_id, s.dias_semana, s.activo
      INTO v_servicio
      FROM public.servicios_objetivo s
      WHERE s.id = (v_fila->>'servicio_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Servicio inexistente';
      END IF;
      IF NOT v_servicio.activo THEN
        RAISE EXCEPTION 'Servicio inactivo';
      END IF;

      SELECT o.estado, o.es_prueba INTO v_objetivo
      FROM public.objetivos o WHERE o.id = v_servicio.objetivo_id;
      IF NOT FOUND OR v_objetivo.estado <> 'activo' THEN
        RAISE EXCEPTION 'Objetivo inactivo';
      END IF;
      IF v_objetivo.es_prueba THEN
        RAISE EXCEPTION 'Objetivo de prueba excluido';
      END IF;

      IF v_servicio.puesto_id IS NULL THEN
        RAISE EXCEPTION 'Servicio sin puesto vinculado';
      END IF;
      PERFORM 1 FROM public.puestos p
      WHERE p.id = v_servicio.puesto_id AND p.activo AND p.objetivo_id = v_servicio.objetivo_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Puesto inactivo o de otro objetivo';
      END IF;

      SELECT tb.hora_inicio, tb.hora_fin, tb.activo INTO v_tb
      FROM public.turnos_base tb WHERE tb.id = v_servicio.turno_base_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno base inexistente';
      END IF;
      IF NOT v_tb.activo THEN
        RAISE EXCEPTION 'Turno base inactivo';
      END IF;
      IF v_tb.hora_inicio IS NULL OR v_tb.hora_fin IS NULL THEN
        RAISE EXCEPTION 'Franja horaria invalida';
      END IF;

      -- Sin creación retroactiva: fecha anterior al día de ejecución, o la
      -- de hoy cuando el turno ya comenzó.
      IF v_fecha < v_hoy_arg OR (v_fecha = v_hoy_arg AND v_tb.hora_inicio <= v_hora_arg) THEN
        RAISE EXCEPTION 'fecha_pasada';
      END IF;

      v_dow := EXTRACT(ISODOW FROM v_fecha);
      IF v_servicio.dias_semana IS NULL OR NOT (v_dow = ANY (v_servicio.dias_semana)) THEN
        RAISE EXCEPTION 'El dia no corresponde a los dias del servicio';
      END IF;

      SELECT t.id, t.servicio_base_id INTO v_exist
      FROM public.turnos t
      WHERE t.fecha = v_fecha
        AND t.hora_inicio = v_tb.hora_inicio
        AND t.hora_fin = v_tb.hora_fin
        AND t.puesto_id = v_servicio.puesto_id
        AND COALESCE(t.tipo_evento, 'normal') = 'normal'
        AND COALESCE(t.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
        AND (t.servicio_base_id = v_servicio.id OR t.objetivo_id = v_servicio.objetivo_id)
      ORDER BY (t.servicio_base_id = v_servicio.id) DESC
      LIMIT 1;
      IF FOUND THEN
        v_res := 'ya_existe';
        v_motivo := CASE WHEN v_exist.servicio_base_id = v_servicio.id
          THEN 'Ya generado desde este servicio'
          ELSE 'Coincide con un turno ya cargado para ese puesto y horario' END;
        v_turno_id := v_exist.id;
      ELSE
        INSERT INTO public.turnos (
          objetivo_id, puesto_id, servicio_base_id, fecha, hora_inicio, hora_fin,
          estado, tipo_evento, estado_revision, guardia_id, guardia_original_id, guardia_real_id
        ) VALUES (
          v_servicio.objetivo_id, v_servicio.puesto_id, v_servicio.id, v_fecha,
          v_tb.hora_inicio, v_tb.hora_fin,
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
      'servicio_id', v_fila->>'servicio_id',
      'fecha', v_fila->>'fecha',
      'resultado', v_res,
      'motivo', v_motivo,
      'turno_id', v_turno_id
    );
  END LOOP;

  v_resultado := jsonb_build_object(
    'operacion_id', p_operacion_id,
    'mes', p_mes,
    'solicitadas', jsonb_array_length(p_filas),
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
    p_operacion_id, v_actor.id, v_uid, p_mes, p_filas, v_hash,
    jsonb_array_length(p_filas), v_creadas, v_ya, v_omitidas,
    v_creados, v_resultado
  );

  RETURN v_resultado;
END;
$BODY$;

REVOKE ALL ON FUNCTION public.crear_turnos_programacion_parcial(uuid, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_turnos_programacion_parcial(uuid, text, jsonb) TO authenticated;
