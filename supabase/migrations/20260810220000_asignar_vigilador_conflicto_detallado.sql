-- Asignación de vigilador: el conflicto de horario explica cuál es
--
-- CAUSA
-- La detección de superposición ya existía y era correcta —contempla nocturnos
-- y estados sin obligación— pero usaba PERFORM:
--
--     PERFORM 1 FROM public.turnos t2 WHERE ...;
--     IF FOUND THEN
--       RAISE EXCEPTION 'El vigilador ya tiene un turno superpuesto en ese horario';
--     END IF;
--
-- PERFORM descarta la fila. La función encontraba el turno en conflicto y tiraba
-- sus datos en el mismo movimiento, así que el único dato que llegaba al cliente
-- era esa frase genérica, capturada después por EXCEPTION WHEN OTHERS en SQLERRM.
-- No era una carencia de la UI: del servidor no salía nada más que eso.
--
-- QUÉ CAMBIA
-- PERFORM pasa a SELECT ... INTO y se conserva el turno conflictivo con su
-- objetivo, su posición, su fecha y su horario. Con eso se arma:
--
--   · un mensaje legible, que es el que ya viaja en `motivo`:
--     "No se puede asignar a ALVAREZ, YAMIL. Ya tiene un turno de 17:00 a 07:00
--      en Laromet ruta 34 (Vigilador 2) el 12/08/2026."
--
--   · un objeto `conflicto` nuevo en la fila del resultado, con los campos
--     sueltos para que la UI pueda componer el texto a su manera sin volver a
--     consultar ni re-detectar nada.
--
-- Horarios en 24 horas (HH24:MI), como el resto del sistema.
--
-- La detección NO se toca: mismo WHERE, mismos límites de fecha, mismo criterio
-- de estados sin obligación. Solo se deja de descartar lo que ya encontraba.
--
-- Firma sin cambios (uuid, uuid, uuid[], boolean): CREATE OR REPLACE no genera
-- sobrecarga. Aditiva y reversible.

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
  -- Turno que provoca la superposición, con su contexto para el mensaje.
  v_conf       record;
  v_conflicto  jsonb;
  v_nombre     text;
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

  -- Se agregan apellido y nombre: son para el mensaje del conflicto, no para
  -- ninguna validación.
  SELECT estado, rol, apellido, nombre INTO v_guardia
  FROM public.usuarios WHERE id = p_guardia_id;
  IF NOT FOUND OR v_guardia.estado <> 'activo' OR v_guardia.rol NOT IN ('guardia', 'vigilador') THEN
    RAISE EXCEPTION 'El vigilador elegido no esta activo';
  END IF;

  v_nombre := trim(both ', ' FROM concat_ws(', ',
    nullif(trim(coalesce(v_guardia.apellido, '')), ''),
    nullif(trim(coalesce(v_guardia.nombre, '')), '')));
  IF v_nombre = '' THEN
    v_nombre := 'el vigilador';
  END IF;

  v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;
  v_comentario := 'Asignacion ' || CASE WHEN p_masiva THEN 'masiva' ELSE 'individual' END
    || ' de vigilador (operacion ' || p_operacion_id::text || ')';

  FOREACH v_tid IN ARRAY p_turno_ids LOOP
    v_res := 'omitida';
    v_motivo := NULL;
    v_conflicto := NULL;
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
        -- nocturnos que cruzan medianoche). Mismo criterio de siempre; lo único
        -- que cambia es que ahora se conserva la fila encontrada.
        v_ini1 := v_turno.fecha + v_turno.hora_inicio;
        v_fin1 := v_turno.fecha + v_turno.hora_fin
          + CASE WHEN v_turno.hora_fin <= v_turno.hora_inicio THEN interval '1 day' ELSE interval '0 day' END;

        SELECT t2.id, t2.fecha, t2.hora_inicio, t2.hora_fin,
               o2.nombre AS objetivo_nombre, p2.nombre AS puesto_nombre
        INTO v_conf
        FROM public.turnos t2
        JOIN public.objetivos o2 ON o2.id = t2.objetivo_id
        LEFT JOIN public.puestos p2 ON p2.id = t2.puesto_id
        WHERE t2.guardia_id = p_guardia_id
          AND t2.id <> v_turno.id
          AND COALESCE(t2.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
          AND t2.fecha BETWEEN v_turno.fecha - 1 AND v_turno.fecha + 1
          AND (t2.fecha + t2.hora_inicio) < v_fin1
          AND v_ini1 < (t2.fecha + t2.hora_fin
            + CASE WHEN t2.hora_fin <= t2.hora_inicio THEN interval '1 day' ELSE interval '0 day' END)
        ORDER BY t2.fecha, t2.hora_inicio
        LIMIT 1;

        IF FOUND THEN
          -- Campos sueltos para que la UI arme el texto como quiera, sin volver
          -- a consultar ni re-detectar el conflicto por su cuenta.
          v_conflicto := jsonb_build_object(
            'turno_id',   v_conf.id,
            'vigilador',  v_nombre,
            'objetivo',   v_conf.objetivo_nombre,
            'puesto',     v_conf.puesto_nombre,
            'fecha',      v_conf.fecha,
            'hora_inicio', to_char(v_conf.hora_inicio, 'HH24:MI'),
            'hora_fin',    to_char(v_conf.hora_fin,    'HH24:MI')
          );

          -- Un solo marcador para objetivo+puesto: en el formato de RAISE, '%%'
          -- es un porcentaje literal, no dos marcadores.
          RAISE EXCEPTION 'No se puede asignar a %. Ya tiene un turno de % a % en % el %.',
            v_nombre,
            to_char(v_conf.hora_inicio, 'HH24:MI'),
            to_char(v_conf.hora_fin,    'HH24:MI'),
            coalesce(v_conf.objetivo_nombre, 'otro objetivo')
              || CASE WHEN v_conf.puesto_nombre IS NULL THEN ''
                      ELSE ' (' || v_conf.puesto_nombre || ')' END,
            to_char(v_conf.fecha, 'DD/MM/YYYY');
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
      -- v_conflicto sobrevive al RAISE: una excepción capturada revierte los
      -- cambios en la base, no las asignaciones de variables previas.
      v_res := 'omitida';
      v_motivo := SQLERRM;
    END;

    IF v_res = 'asignada' THEN v_asignadas := v_asignadas + 1;
    ELSIF v_res = 'ya_asignada' THEN v_ya := v_ya + 1;
    ELSE v_omitidas := v_omitidas + 1;
    END IF;

    v_filas := v_filas || jsonb_build_object(
      'turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo, 'conflicto', v_conflicto);
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

COMMENT ON FUNCTION public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean) IS
  'Asigna un vigilador a turnos programados. Valida por turno sin abortar el lote. '
  'Ante superposición horaria devuelve, además del motivo legible, un objeto '
  '`conflicto` con vigilador, objetivo, puesto, fecha y horario del turno que choca.';
