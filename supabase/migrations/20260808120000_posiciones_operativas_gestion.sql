-- Bloque E — Gestión de posiciones operativas desde el legajo del objetivo
--
-- Alta, edición, duplicación, desactivación y eliminación excepcional de
-- posiciones operativas (tabla técnica `puestos`; el nombre visible en la
-- interfaz es "posición operativa"). El horario y los días de cobertura NO
-- viven acá: siguen siendo dominio exclusivo de `servicios_objetivo`.
--
-- Toda escritura pasa por una RPC SECURITY DEFINER (nunca por el cliente
-- directo, aunque `puestos` ya tenía policies de admin desde el backfill
-- original): valida en servidor, es transaccional y audita en
-- `puestos_auditoria`. Solo administración activa escribe en este bloque;
-- el supervisor queda en solo lectura (preferencia explícita, no se amplía).
--
-- Aditiva y reversible. No toca turnos, servicios ni objetivos existentes.

-- ── Columna nueva (observación opcional del formulario) ─────────────────────
ALTER TABLE public.puestos ADD COLUMN IF NOT EXISTS observacion text;

-- ── Auditoría ────────────────────────────────────────────────────────────────
-- puesto_id nullable con ON DELETE SET NULL: la eliminación excepcional (§5)
-- no debe romper su propio historial. nombre_puesto y objetivo_id quedan
-- como snapshot para que la fila siga siendo legible después de un SET NULL.
CREATE TABLE IF NOT EXISTS public.puestos_auditoria (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puesto_id         uuid REFERENCES public.puestos(id) ON DELETE SET NULL,
  objetivo_id       uuid NOT NULL REFERENCES public.objetivos(id),
  nombre_puesto     text NOT NULL,
  usuario_id        uuid NOT NULL REFERENCES public.usuarios(id),
  auth_user_id      uuid NOT NULL,
  accion            text NOT NULL CHECK (accion IN ('crear', 'editar', 'duplicar', 'activar', 'desactivar', 'eliminar')),
  campo             text,
  valor_anterior    text,
  valor_nuevo       text,
  motivo            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puestos_auditoria_puesto ON public.puestos_auditoria (puesto_id);
CREATE INDEX IF NOT EXISTS idx_puestos_auditoria_objetivo ON public.puestos_auditoria (objetivo_id);

ALTER TABLE public.puestos_auditoria ENABLE ROW LEVEL SECURITY;

-- Lectura: admin ve todo; supervisor solo dentro de sus zonas asignadas (sin
-- zonas asignadas = alcance total, misma regla ya vigente en el resto del
-- proyecto para el alcance del supervisor).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'puestos_auditoria'
      AND policyname = 'puestos_auditoria_select'
  ) THEN
    CREATE POLICY puestos_auditoria_select
      ON public.puestos_auditoria FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.usuarios u
          WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'admin'
        )
        OR EXISTS (
          SELECT 1 FROM public.usuarios u
          WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol = 'supervisor'
            AND (
              NOT EXISTS (SELECT 1 FROM public.supervisor_zonas sz WHERE sz.supervisor_id = u.id)
              OR EXISTS (
                SELECT 1 FROM public.supervisor_zonas sz
                JOIN public.objetivos o ON o.zona_id = sz.zona_id
                WHERE sz.supervisor_id = u.id AND o.id = puestos_auditoria.objetivo_id
              )
            )
        )
      );
  END IF;
END $$;

REVOKE ALL ON public.puestos_auditoria FROM anon;
GRANT SELECT ON public.puestos_auditoria TO authenticated;

-- ── RPC: crear ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_posicion_operativa(
  p_objetivo_id uuid,
  p_nombre      text,
  p_orden       integer DEFAULT NULL,
  p_observacion text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid       uuid;
  v_actor     uuid;
  v_objetivo  record;
  v_nombre    text;
  v_orden     integer;
  v_id        uuid;
  v_resultado jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id INTO v_actor FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la gestion de posiciones operativas es exclusiva de administracion';
  END IF;

  SELECT id, estado INTO v_objetivo FROM public.objetivos WHERE id = p_objetivo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objetivo inexistente';
  END IF;
  IF v_objetivo.estado <> 'activo' THEN
    RAISE EXCEPTION 'El objetivo no esta activo';
  END IF;

  v_nombre := trim(p_nombre);
  IF v_nombre = '' OR v_nombre IS NULL THEN
    RAISE EXCEPTION 'El nombre de la posicion es obligatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.puestos p
    WHERE p.objetivo_id = p_objetivo_id AND p.activo
      AND lower(regexp_replace(trim(p.nombre), '\s+', ' ', 'g')) = lower(regexp_replace(v_nombre, '\s+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'Ya existe una posicion operativa activa con ese nombre en este objetivo';
  END IF;

  v_orden := p_orden;
  IF v_orden IS NULL THEN
    SELECT COALESCE(MAX(orden), 0) + 1 INTO v_orden FROM public.puestos WHERE objetivo_id = p_objetivo_id;
  END IF;

  INSERT INTO public.puestos (objetivo_id, nombre, activo, orden, observacion)
  VALUES (p_objetivo_id, v_nombre, true, v_orden, NULLIF(trim(COALESCE(p_observacion, '')), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.puestos_auditoria (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, valor_nuevo, motivo)
  VALUES (v_id, p_objetivo_id, v_nombre, v_actor, v_uid, 'crear', v_nombre, p_observacion);

  SELECT to_jsonb(p) INTO v_resultado FROM public.puestos p WHERE p.id = v_id;
  RETURN v_resultado;
END;
$BODY$;

REVOKE ALL ON FUNCTION public.crear_posicion_operativa(uuid, text, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_posicion_operativa(uuid, text, integer, text) TO authenticated;

-- ── RPC: editar (incluye activar/desactivar por el mismo campo `activo`) ────
CREATE OR REPLACE FUNCTION public.editar_posicion_operativa(
  p_id          uuid,
  p_nombre      text DEFAULT NULL,
  p_orden       integer DEFAULT NULL,
  p_observacion text DEFAULT NULL,
  p_activo      boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid          uuid;
  v_actor        uuid;
  v_actual       record;
  v_nombre_final text;
  v_hoy_arg      date;
  v_hora_arg     time;
  v_turnos_fut   integer;
  v_servicios    integer;
  v_resultado    jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id INTO v_actor FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la gestion de posiciones operativas es exclusiva de administracion';
  END IF;

  SELECT id, objetivo_id, nombre, orden, observacion, activo INTO v_actual
  FROM public.puestos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa inexistente';
  END IF;

  v_nombre_final := COALESCE(NULLIF(trim(p_nombre), ''), v_actual.nombre);
  IF p_nombre IS NOT NULL AND trim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre de la posicion es obligatorio';
  END IF;

  -- Duplicado: solo importa si el resultado final queda activo (activo
  -- explicito o el que ya tenia) y el nombre cambia, o si se reactiva.
  IF (v_nombre_final IS DISTINCT FROM v_actual.nombre OR (p_activo IS TRUE AND NOT v_actual.activo))
     AND COALESCE(p_activo, v_actual.activo) THEN
    IF EXISTS (
      SELECT 1 FROM public.puestos p
      WHERE p.objetivo_id = v_actual.objetivo_id AND p.activo AND p.id <> p_id
        AND lower(regexp_replace(trim(p.nombre), '\s+', ' ', 'g')) = lower(regexp_replace(v_nombre_final, '\s+', ' ', 'g'))
    ) THEN
      RAISE EXCEPTION 'Ya existe una posicion operativa activa con ese nombre en este objetivo';
    END IF;
  END IF;

  -- Transicion a inactivo: valida dependencias en servidor (no confiar solo en la UI).
  IF p_activo IS FALSE AND v_actual.activo THEN
    v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
    v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;

    SELECT count(*) INTO v_turnos_fut FROM public.turnos t
    WHERE t.puesto_id = p_id AND t.estado <> 'reemplazado'
      AND (t.fecha > v_hoy_arg OR (t.fecha = v_hoy_arg AND t.hora_inicio > v_hora_arg));
    SELECT count(*) INTO v_servicios FROM public.servicios_objetivo s
    WHERE s.puesto_id = p_id AND s.activo;

    IF v_turnos_fut > 0 OR v_servicios > 0 THEN
      RAISE EXCEPTION 'No se puede desactivar: % turno(s) futuro(s) vigente(s) y % servicio(s) activo(s) vinculado(s)', v_turnos_fut, v_servicios;
    END IF;
  END IF;

  UPDATE public.puestos SET
    nombre      = v_nombre_final,
    orden       = COALESCE(p_orden, orden),
    observacion = CASE WHEN p_observacion IS NULL THEN observacion ELSE NULLIF(trim(p_observacion), '') END,
    activo      = COALESCE(p_activo, activo),
    updated_at  = now()
  WHERE id = p_id;

  IF v_nombre_final IS DISTINCT FROM v_actual.nombre THEN
    INSERT INTO public.puestos_auditoria (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid, 'editar', 'nombre', v_actual.nombre, v_nombre_final);
  END IF;
  IF p_orden IS NOT NULL AND p_orden IS DISTINCT FROM v_actual.orden THEN
    INSERT INTO public.puestos_auditoria (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid, 'editar', 'orden', v_actual.orden::text, p_orden::text);
  END IF;
  IF p_observacion IS NOT NULL AND NULLIF(trim(p_observacion), '') IS DISTINCT FROM v_actual.observacion THEN
    INSERT INTO public.puestos_auditoria (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid, 'editar', 'observacion', v_actual.observacion, NULLIF(trim(p_observacion), ''));
  END IF;
  IF p_activo IS NOT NULL AND p_activo IS DISTINCT FROM v_actual.activo THEN
    INSERT INTO public.puestos_auditoria (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid,
            CASE WHEN p_activo THEN 'activar' ELSE 'desactivar' END,
            'activo', v_actual.activo::text, p_activo::text);
  END IF;

  SELECT to_jsonb(p) INTO v_resultado FROM public.puestos p WHERE p.id = p_id;
  RETURN v_resultado;
END;
$BODY$;

REVOKE ALL ON FUNCTION public.editar_posicion_operativa(uuid, text, integer, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.editar_posicion_operativa(uuid, text, integer, text, boolean) TO authenticated;

-- ── RPC: duplicar ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.duplicar_posicion_operativa(
  p_id_origen    uuid,
  p_nombre_nuevo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid       uuid;
  v_actor     uuid;
  v_origen    record;
  v_nombre    text;
  v_orden     integer;
  v_id        uuid;
  v_resultado jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id INTO v_actor FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la gestion de posiciones operativas es exclusiva de administracion';
  END IF;

  SELECT id, objetivo_id, nombre INTO v_origen FROM public.puestos WHERE id = p_id_origen;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa de origen inexistente';
  END IF;

  v_nombre := trim(p_nombre_nuevo);
  IF v_nombre = '' OR v_nombre IS NULL THEN
    RAISE EXCEPTION 'El nombre de la posicion es obligatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.puestos p
    WHERE p.objetivo_id = v_origen.objetivo_id AND p.activo
      AND lower(regexp_replace(trim(p.nombre), '\s+', ' ', 'g')) = lower(regexp_replace(v_nombre, '\s+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'Ya existe una posicion operativa activa con ese nombre en este objetivo';
  END IF;

  SELECT COALESCE(MAX(orden), 0) + 1 INTO v_orden FROM public.puestos WHERE objetivo_id = v_origen.objetivo_id;

  -- Nunca copia turnos, servicios, GPS, rondas ni checklists: solo la fila
  -- nueva en `puestos`, activa y sin referencias.
  INSERT INTO public.puestos (objetivo_id, nombre, activo, orden)
  VALUES (v_origen.objetivo_id, v_nombre, true, v_orden)
  RETURNING id INTO v_id;

  INSERT INTO public.puestos_auditoria (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, valor_anterior, valor_nuevo, motivo)
  VALUES (v_id, v_origen.objetivo_id, v_nombre, v_actor, v_uid, 'duplicar', v_origen.nombre, v_nombre, 'Duplicado desde posicion ' || v_origen.nombre);

  SELECT to_jsonb(p) INTO v_resultado FROM public.puestos p WHERE p.id = v_id;
  RETURN v_resultado;
END;
$BODY$;

REVOKE ALL ON FUNCTION public.duplicar_posicion_operativa(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.duplicar_posicion_operativa(uuid, text) TO authenticated;

-- ── RPC: eliminar (excepcional, solo sin ninguna referencia) ────────────────
CREATE OR REPLACE FUNCTION public.eliminar_posicion_operativa(
  p_id     uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid       uuid;
  v_actor     uuid;
  v_actual    record;
  v_turnos    integer;
  v_servicios integer;
  v_auditoria integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id INTO v_actor FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la gestion de posiciones operativas es exclusiva de administracion';
  END IF;

  SELECT id, objetivo_id, nombre INTO v_actual FROM public.puestos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa inexistente';
  END IF;

  SELECT count(*) INTO v_turnos FROM public.turnos WHERE puesto_id = p_id;
  SELECT count(*) INTO v_servicios FROM public.servicios_objetivo WHERE puesto_id = p_id;
  SELECT count(*) INTO v_auditoria FROM public.puestos_auditoria WHERE puesto_id = p_id AND accion <> 'crear';

  IF v_turnos > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: la posicion tiene % turno(s) asociado(s). Usa Desactivar.', v_turnos;
  END IF;
  IF v_servicios > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: la posicion tiene % servicio(s) asociado(s). Usa Desactivar.', v_servicios;
  END IF;
  IF v_auditoria > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: la posicion tiene historial de operaciones. Usa Desactivar.';
  END IF;

  -- Auditoría de la eliminación primero (con puesto_id todavía válido); el
  -- DELETE que sigue deja puesto_id en NULL por ON DELETE SET NULL, tanto en
  -- esta fila como en la de 'crear' original — nombre_puesto conserva el dato.
  INSERT INTO public.puestos_auditoria (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, motivo)
  VALUES (p_id, v_actual.objetivo_id, v_actual.nombre, v_actor, v_uid, 'eliminar', p_motivo);

  DELETE FROM public.puestos WHERE id = p_id;

  RETURN jsonb_build_object('eliminado', true, 'id', p_id, 'nombre', v_actual.nombre);
END;
$BODY$;

REVOKE ALL ON FUNCTION public.eliminar_posicion_operativa(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_posicion_operativa(uuid, text) TO authenticated;
