-- Bloque D — Revisión del supervisor sobre el primer control (OT-01 continuidad)
--
-- 1. Alcance operativo en RLS: un supervisor solo lee aceptaciones y
--    solicitudes de turnos cuyos objetivos pertenecen a sus zonas
--    (supervisor_zonas + objetivos.zona_id). Regla existente del proyecto:
--    supervisor SIN zonas asignadas conserva alcance total. Admin ve todo.
-- 2. Tabla revisiones_planilla: constancia de cada intervención del
--    supervisor (revisado / observación / derivar a administración).
--    Nunca modifica horas ni el texto original del vigilador.
-- 3. RPC revisar_primer_control: única vía de escritura. El cambio de
--    estado de la solicitud y el evento de auditoría ocurren en la misma
--    transacción (sin UPDATE silencioso).
--
-- Idempotente: IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.

-- ── 1. Helper de alcance ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.turno_en_alcance_supervisor(
  p_turno_id uuid,
  p_usuario_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $HELPER$
  SELECT NOT EXISTS (
           SELECT 1 FROM public.supervisor_zonas sz
           WHERE sz.supervisor_id = p_usuario_id
         )
      OR EXISTS (
           SELECT 1
           FROM public.turnos t
           JOIN public.objetivos o ON o.id = t.objetivo_id
           JOIN public.supervisor_zonas sz
             ON sz.zona_id = o.zona_id AND sz.supervisor_id = p_usuario_id
           WHERE t.id = p_turno_id
         );
$HELPER$;

REVOKE ALL ON FUNCTION public.turno_en_alcance_supervisor(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.turno_en_alcance_supervisor(uuid, uuid) TO authenticated;

-- ── 2. Corregir alcance de las policies de OT-02 ─────────────────────────────

DROP POLICY IF EXISTS aceptaciones_planilla_select ON public.aceptaciones_planilla;
CREATE POLICY aceptaciones_planilla_select
  ON public.aceptaciones_planilla FOR SELECT
  USING (
    empleado_id IN (SELECT u.id FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'supervisor'
        AND public.turno_en_alcance_supervisor(aceptaciones_planilla.turno_id, u.id)
    )
  );

DROP POLICY IF EXISTS solicitudes_mod_planilla_select ON public.solicitudes_modificacion_planilla;
CREATE POLICY solicitudes_mod_planilla_select
  ON public.solicitudes_modificacion_planilla FOR SELECT
  USING (
    empleado_id IN (SELECT u.id FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'supervisor'
        AND public.turno_en_alcance_supervisor(solicitudes_modificacion_planilla.turno_id, u.id)
    )
  );

-- ── 3. Tabla de revisiones ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.revisiones_planilla (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id         uuid NOT NULL REFERENCES public.turnos(id),
  empleado_id      uuid NOT NULL REFERENCES public.usuarios(id),
  solicitud_id     uuid REFERENCES public.solicitudes_modificacion_planilla(id),
  supervisor_id    uuid NOT NULL REFERENCES public.usuarios(id),
  auth_user_id     uuid NOT NULL,
  accion           text NOT NULL CHECK (accion IN ('revisado', 'observacion', 'derivar_administracion')),
  comentario       text,
  estado_anterior  text,
  estado_posterior text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revisiones_planilla_turno ON public.revisiones_planilla (turno_id);
CREATE INDEX IF NOT EXISTS idx_revisiones_planilla_empleado ON public.revisiones_planilla (empleado_id);
CREATE INDEX IF NOT EXISTS idx_revisiones_planilla_solicitud ON public.revisiones_planilla (solicitud_id);
CREATE INDEX IF NOT EXISTS idx_revisiones_planilla_accion ON public.revisiones_planilla (accion);

ALTER TABLE public.revisiones_planilla ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS revisiones_planilla_select ON public.revisiones_planilla;
CREATE POLICY revisiones_planilla_select
  ON public.revisiones_planilla FOR SELECT
  USING (
    empleado_id IN (SELECT u.id FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'supervisor'
        AND public.turno_en_alcance_supervisor(revisiones_planilla.turno_id, u.id)
    )
  );

REVOKE ALL ON public.revisiones_planilla FROM anon;
GRANT SELECT ON public.revisiones_planilla TO authenticated;

-- ── 4. RPC de revisión ───────────────────────────────────────────────────────
-- No crea asistencia, no corrige fichajes, no modifica horas liquidables,
-- no cierra solicitudes silenciosamente y no toca el texto del vigilador.

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
    -- Idempotencia a nivel turno: un solo evento 'revisado' por turno/empleado
    SELECT id INTO v_id
    FROM public.revisiones_planilla
    WHERE turno_id = p_turno_id AND empleado_id = p_empleado_id
      AND accion = 'revisado' AND solicitud_id IS NULL
    LIMIT 1;
    IF FOUND THEN
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
