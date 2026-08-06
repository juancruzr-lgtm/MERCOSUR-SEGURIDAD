-- Bloque E — Asignación de vigiladores sobre turnos programados
--
-- Estados conceptuales: Programado (sin vigilador) → Asignado (con
-- vigilador, todavía no comunicado) → Publicado (futuro, fuera de alcance).
-- Esta RPC solo pasa de Programado a Asignado. No publica ni notifica.
--
-- RPC asignar_vigilador_turnos(p_operacion_id, p_guardia_id, p_turno_ids, p_masiva):
--   · admin activo, o supervisor activo dentro de su alcance de zonas
--     (regla existente: supervisor sin zonas = alcance total);
--   · valida POR TURNO sin abortar el lote: turno vigente y de cobertura
--     normal, futuro o no iniciado (hora Argentina UTC-3 fija y sin entrada
--     de asistencia registrada), objetivo activo, posición activa,
--     vigilador activo, sin superposición horaria (cruces de medianoche
--     incluidos);
--   · nunca sobrescribe una asignación previa: un turno ya asignado al
--     mismo vigilador vuelve como 'ya_asignada' (reintento idempotente);
--     asignado a otro vigilador vuelve omitido (la reasignación es del
--     flujo de edición auditado, con trazabilidad propia);
--   · primera asignación: guardia_id y guardia_original_id reciben ambos
--     el vigilador elegido (guardia_original_id solo si estaba NULL);
--   · auditoría por turno en turnos_auditoria (usuario, campo, valor
--     anterior/nuevo, comentario con operación e individual/masiva);
--   · resultado detallado por fila.
--
-- Aditiva, reversible (DROP FUNCTION). No modifica datos por sí sola.

CREATE OR REPLACE FUNCTION public.asignar_vigilador_turnos(
  p_operacion_id uuid,
  p_guardia_id   uuid,
  p_turno_ids    uuid[],
  p_masiva       boolean DEFAULT false
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
  v_guardia    record;
  v_tid        uuid;
  v_turno      record;
  v_hoy_arg    date;
  v_hora_arg   time;
  v_ini1       timestamp;
  v_fin1       timestamp;
  v_res        text;
  v_motivo     text;
  v_filas      jsonb := '[]'::jsonb;
  v_asignadas  integer := 0;
  v_ya         integer := 0;
  v_omitidas   integer := 0;
  v_comentario text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id, rol INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la asignacion es de administracion o supervision';
  END IF;

  IF v_actor.rol = 'supervisor' THEN
    SELECT array_agg(zona_id) INTO v_zonas
    FROM public.supervisor_zonas WHERE supervisor_id = v_actor.id;
    -- v_zonas NULL = supervisor sin zonas = alcance total (regla existente).
  END IF;

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'operacion_id requerido';
  END IF;
  IF p_guardia_id IS NULL THEN
    RAISE EXCEPTION 'Vigilador requerido';
  END IF;
  IF p_turno_ids IS NULL OR array_length(p_turno_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No hay turnos seleccionados';
  END IF;
  IF array_length(p_turno_ids, 1) > 100 THEN
    RAISE EXCEPTION 'Demasiados turnos para una sola operacion (maximo 100)';
  END IF;

  SELECT estado, rol INTO v_guardia FROM public.usuarios WHERE id = p_guardia_id;
  IF NOT FOUND OR v_guardia.estado <> 'activo' OR v_guardia.rol NOT IN ('guardia', 'vigilador') THEN
    RAISE EXCEPTION 'El vigilador elegido no esta activo';
  END IF;

  v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;
  v_comentario := 'Asignacion ' || CASE WHEN p_masiva THEN 'masiva' ELSE 'individual' END
    || ' de vigilador (operacion ' || p_operacion_id::text || ')';

  FOREACH v_tid IN ARRAY p_turno_ids LOOP
    v_res := 'omitida';
    v_motivo := NULL;
    BEGIN
      SELECT t.*, o.estado AS objetivo_estado, o.zona_id AS objetivo_zona,
             p.activo AS puesto_activo
      INTO v_turno
      FROM public.turnos t
      JOIN public.objetivos o ON o.id = t.objetivo_id
      LEFT JOIN public.puestos p ON p.id = t.puesto_id
      WHERE t.id = v_tid
      FOR UPDATE OF t;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno inexistente';
      END IF;
      IF v_turno.objetivo_estado <> 'activo' THEN
        RAISE EXCEPTION 'Objetivo inactivo';
      END IF;
      IF v_actor.rol = 'supervisor' AND v_zonas IS NOT NULL
         AND NOT (v_turno.objetivo_zona = ANY (v_zonas)) THEN
        RAISE EXCEPTION 'Objetivo fuera de la zona del supervisor';
      END IF;
      IF v_turno.puesto_id IS NOT NULL AND v_turno.puesto_activo IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Posicion operativa inactiva';
      END IF;
      IF COALESCE(v_turno.estado, '') IN ('reemplazado', 'anulado', 'cancelado') THEN
        RAISE EXCEPTION 'Turno sin obligacion de cobertura';
      END IF;
      IF COALESCE(v_turno.tipo_evento, 'normal') <> 'normal' THEN
        RAISE EXCEPTION 'Solo se asignan turnos de cobertura normal';
      END IF;
      IF v_turno.fecha < v_hoy_arg
         OR (v_turno.fecha = v_hoy_arg AND v_turno.hora_inicio <= v_hora_arg) THEN
        RAISE EXCEPTION 'El turno ya inicio o es pasado';
      END IF;
      PERFORM 1 FROM public.registros_asistencia r
      WHERE r.turno_id = v_turno.id AND COALESCE(r.tipo_registro, '') <> 'ausencia'
        AND (r.hora_entrada_real IS NOT NULL OR r.hora_entrada_final IS NOT NULL);
      IF FOUND THEN
        RAISE EXCEPTION 'El turno ya tiene asistencia registrada';
      END IF;

      IF v_turno.guardia_id IS NOT NULL THEN
        IF v_turno.guardia_id = p_guardia_id THEN
          v_res := 'ya_asignada';
          v_motivo := 'Ya estaba asignado a este vigilador';
        ELSE
          RAISE EXCEPTION 'Ya asignado a otro vigilador: reasignar desde la edicion del turno';
        END IF;
      ELSE
        -- Superposición con otros turnos vigentes del vigilador (incluye
        -- nocturnos que cruzan medianoche).
        v_ini1 := v_turno.fecha + v_turno.hora_inicio;
        v_fin1 := v_turno.fecha + v_turno.hora_fin
          + CASE WHEN v_turno.hora_fin <= v_turno.hora_inicio THEN interval '1 day' ELSE interval '0 day' END;
        PERFORM 1 FROM public.turnos t2
        WHERE t2.guardia_id = p_guardia_id
          AND t2.id <> v_turno.id
          AND COALESCE(t2.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
          AND t2.fecha BETWEEN v_turno.fecha - 1 AND v_turno.fecha + 1
          AND (t2.fecha + t2.hora_inicio) < v_fin1
          AND v_ini1 < (t2.fecha + t2.hora_fin
            + CASE WHEN t2.hora_fin <= t2.hora_inicio THEN interval '1 day' ELSE interval '0 day' END);
        IF FOUND THEN
          RAISE EXCEPTION 'El vigilador ya tiene un turno superpuesto en ese horario';
        END IF;

        UPDATE public.turnos
        SET guardia_id = p_guardia_id,
            guardia_original_id = COALESCE(guardia_original_id, p_guardia_id)
        WHERE id = v_turno.id;

        INSERT INTO public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
        VALUES (v_turno.id, v_actor.id, 'guardia_id', NULL, p_guardia_id::text, v_comentario);
        IF v_turno.guardia_original_id IS NULL THEN
          INSERT INTO public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
          VALUES (v_turno.id, v_actor.id, 'guardia_original_id', NULL, p_guardia_id::text, v_comentario);
        END IF;
        v_res := 'asignada';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_res := 'omitida';
      v_motivo := SQLERRM;
    END;

    IF v_res = 'asignada' THEN v_asignadas := v_asignadas + 1;
    ELSIF v_res = 'ya_asignada' THEN v_ya := v_ya + 1;
    ELSE v_omitidas := v_omitidas + 1;
    END IF;

    v_filas := v_filas || jsonb_build_object(
      'turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo);
  END LOOP;

  RETURN jsonb_build_object(
    'operacion_id', p_operacion_id,
    'guardia_id', p_guardia_id,
    'solicitadas', array_length(p_turno_ids, 1),
    'asignadas', v_asignadas,
    'ya_asignadas', v_ya,
    'omitidas', v_omitidas,
    'filas', v_filas
  );
END;
$BODY$;

REVOKE ALL ON FUNCTION public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean) TO authenticated;
