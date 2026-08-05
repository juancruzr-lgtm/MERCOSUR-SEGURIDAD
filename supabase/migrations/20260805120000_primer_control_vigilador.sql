-- ════════════════════════════════════════════════════════════════════
-- 20260805120000_primer_control_vigilador.sql  (OT-02 Bloque C)
--
-- Primer control del vigilador sobre Mi Planilla.
--
-- Tablas nuevas (no existe estructura reutilizable; solicitudes_admin y
-- novedades_laborales son procesos distintos y no se tocan):
--   · aceptaciones_planilla              — el vigilador aceptó lo mostrado
--   · solicitudes_modificacion_planilla  — el vigilador pidió un cambio
--
-- Ninguna de las dos modifica entrada, salida, horas reales, horas
-- liquidables ni regularización. Solo trazabilidad.
--
-- Escritura EXCLUSIVAMENTE vía RPC SECURITY DEFINER (sin policies de
-- INSERT/UPDATE/DELETE): el cliente no escribe directo en tablas de
-- auditoría. El snapshot visible se computa del lado del servidor.
--
-- Idempotente: IF NOT EXISTS / ON CONFLICT / CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tablas ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.aceptaciones_planilla (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id               uuid NOT NULL REFERENCES public.turnos(id),
  empleado_id            uuid NOT NULL REFERENCES public.usuarios(id),
  registro_asistencia_id uuid REFERENCES public.registros_asistencia(id),
  auth_user_id           uuid NOT NULL,
  -- Snapshot de lo que se mostraba al aceptar (computado por la RPC)
  entrada_visible        time,
  salida_visible         time,
  horas_visibles         numeric(6,2),
  salida_automatica      boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- Idempotencia: una única aceptación por turno y empleado
  CONSTRAINT aceptaciones_planilla_unq UNIQUE (turno_id, empleado_id)
);

CREATE INDEX IF NOT EXISTS idx_aceptaciones_planilla_empleado
  ON public.aceptaciones_planilla (empleado_id);
CREATE INDEX IF NOT EXISTS idx_aceptaciones_planilla_turno
  ON public.aceptaciones_planilla (turno_id);

CREATE TABLE IF NOT EXISTS public.solicitudes_modificacion_planilla (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id               uuid NOT NULL REFERENCES public.turnos(id),
  empleado_id            uuid NOT NULL REFERENCES public.usuarios(id),
  registro_asistencia_id uuid REFERENCES public.registros_asistencia(id),
  auth_user_id           uuid NOT NULL,
  texto                  text NOT NULL CHECK (length(btrim(texto)) >= 3),
  -- Snapshot de lo que se mostraba al solicitar (computado por la RPC)
  entrada_visible        time,
  salida_visible         time,
  horas_visibles         numeric(6,2),
  salida_automatica      boolean NOT NULL DEFAULT false,
  estado                 text NOT NULL DEFAULT 'pendiente',
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_mod_planilla_empleado
  ON public.solicitudes_modificacion_planilla (empleado_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_mod_planilla_turno
  ON public.solicitudes_modificacion_planilla (turno_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_mod_planilla_estado
  ON public.solicitudes_modificacion_planilla (estado);

-- Una sola solicitud PENDIENTE por turno y empleado (el historial resuelto
-- se conserva: nunca se sobrescriben registros anteriores).
CREATE UNIQUE INDEX IF NOT EXISTS unq_solicitud_mod_planilla_pendiente
  ON public.solicitudes_modificacion_planilla (turno_id, empleado_id)
  WHERE estado = 'pendiente';

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Lectura: el propio empleado, o admin/supervisor activo (base para la
-- futura bandeja del supervisor — Bloque D, no implementada acá).
-- Escritura: nadie por policy; solo las RPC SECURITY DEFINER.

ALTER TABLE public.aceptaciones_planilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_modificacion_planilla ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'aceptaciones_planilla'
      AND policyname = 'aceptaciones_planilla_select'
  ) THEN
    CREATE POLICY aceptaciones_planilla_select
      ON public.aceptaciones_planilla FOR SELECT
      USING (
        empleado_id IN (SELECT u.id FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.usuarios u
          WHERE u.auth_user_id = auth.uid()
            AND u.estado = 'activo'
            AND u.rol IN ('admin', 'supervisor')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'solicitudes_modificacion_planilla'
      AND policyname = 'solicitudes_mod_planilla_select'
  ) THEN
    CREATE POLICY solicitudes_mod_planilla_select
      ON public.solicitudes_modificacion_planilla FOR SELECT
      USING (
        empleado_id IN (SELECT u.id FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.usuarios u
          WHERE u.auth_user_id = auth.uid()
            AND u.estado = 'activo'
            AND u.rol IN ('admin', 'supervisor')
        )
      );
  END IF;
END $$;

REVOKE ALL ON public.aceptaciones_planilla FROM anon;
REVOKE ALL ON public.solicitudes_modificacion_planilla FROM anon;
GRANT SELECT ON public.aceptaciones_planilla TO authenticated;
GRANT SELECT ON public.solicitudes_modificacion_planilla TO authenticated;

-- ── 3. RPC: aceptar_turno_planilla ───────────────────────────────────────────
-- Idempotente: reintentos o doble clic devuelven la aceptación existente,
-- jamás crean una segunda fila (UNIQUE + ON CONFLICT DO NOTHING).

CREATE OR REPLACE FUNCTION public.aceptar_turno_planilla(p_turno_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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
  -- 1. Sesión autenticada → empleado activo
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

  -- 2. Turno con obligación, finalizado
  SELECT id, fecha, hora_inicio, hora_fin, estado, guardia_id
  INTO v_turno
  FROM public.turnos
  WHERE id = p_turno_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno inexistente';
  END IF;

  IF v_turno.estado IN ('reemplazado', 'anulado', 'cancelado') THEN
    RAISE EXCEPTION 'El turno no tiene obligación (estado %)', v_turno.estado;
  END IF;

  -- Fin del turno en Buenos Aires; los nocturnos terminan al día siguiente
  v_fin := ((v_turno.fecha + CASE WHEN v_turno.hora_fin <= v_turno.hora_inicio THEN 1 ELSE 0 END)::text
            || ' ' || v_turno.hora_fin)::timestamp
           AT TIME ZONE 'America/Argentina/Buenos_Aires';
  IF v_fin > now() THEN
    RAISE EXCEPTION 'El turno todavía no finalizó';
  END IF;

  -- 3. Registro principal del empleado en ese turno (si existe)
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

  IF FOUND THEN
    v_registro_id := v_registro.id;
    v_entrada := COALESCE(v_registro.hora_entrada_final, v_registro.hora_entrada_real);
    v_salida  := COALESCE(v_registro.hora_salida_final,  v_registro.hora_salida_real);
    v_horas   := COALESCE(v_registro.horas_liquidables,  v_registro.horas_trabajadas);
    v_auto    := COALESCE(v_registro.cierre_automatico, false);
  ELSIF v_turno.guardia_id IS DISTINCT FROM v_empleado THEN
    -- Sin registro propio y el turno no está asignado al empleado
    RAISE EXCEPTION 'El turno no corresponde al empleado autenticado';
  END IF;

  -- 4. Insertar aceptación (idempotente). NO modifica ningún dato operativo.
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
$$;

-- ── 4. RPC: solicitar_modificacion_planilla ──────────────────────────────────
-- Texto libre obligatorio. No modifica ningún dato operativo.
-- Una sola solicitud pendiente por turno: reintentos devuelven la existente.

CREATE OR REPLACE FUNCTION public.solicitar_modificacion_planilla(
  p_turno_id uuid,
  p_texto    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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
  IF p_texto IS NULL OR length(btrim(p_texto)) < 3 THEN
    RAISE EXCEPTION 'Debe indicar qué desea modificar';
  END IF;

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
    RAISE EXCEPTION 'El turno no tiene obligación (estado %)', v_turno.estado;
  END IF;

  v_fin := ((v_turno.fecha + CASE WHEN v_turno.hora_fin <= v_turno.hora_inicio THEN 1 ELSE 0 END)::text
            || ' ' || v_turno.hora_fin)::timestamp
           AT TIME ZONE 'America/Argentina/Buenos_Aires';
  IF v_fin > now() THEN
    RAISE EXCEPTION 'El turno todavía no finalizó';
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

  IF FOUND THEN
    v_registro_id := v_registro.id;
    v_entrada := COALESCE(v_registro.hora_entrada_final, v_registro.hora_entrada_real);
    v_salida  := COALESCE(v_registro.hora_salida_final,  v_registro.hora_salida_real);
    v_horas   := COALESCE(v_registro.horas_liquidables,  v_registro.horas_trabajadas);
    v_auto    := COALESCE(v_registro.cierre_automatico, false);
  ELSIF v_turno.guardia_id IS DISTINCT FROM v_empleado THEN
    RAISE EXCEPTION 'El turno no corresponde al empleado autenticado';
  END IF;

  -- Solicitud pendiente existente → devolverla, no duplicar
  SELECT id INTO v_id
  FROM public.solicitudes_modificacion_planilla
  WHERE turno_id = p_turno_id AND empleado_id = v_empleado AND estado = 'pendiente';
  IF FOUND THEN
    RETURN jsonb_build_object('solicitud_id', v_id, 'ya_existente', true);
  END IF;

  BEGIN
    INSERT INTO public.solicitudes_modificacion_planilla (
      turno_id, empleado_id, registro_asistencia_id, auth_user_id, texto,
      entrada_visible, salida_visible, horas_visibles, salida_automatica
    ) VALUES (
      p_turno_id, v_empleado, v_registro_id, v_uid, btrim(p_texto),
      v_entrada, v_salida, v_horas, v_auto
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Carrera entre dos envíos simultáneos: devolver la pendiente ganadora
    SELECT id INTO v_id
    FROM public.solicitudes_modificacion_planilla
    WHERE turno_id = p_turno_id AND empleado_id = v_empleado AND estado = 'pendiente';
    RETURN jsonb_build_object('solicitud_id', v_id, 'ya_existente', true);
  END;

  RETURN jsonb_build_object('solicitud_id', v_id, 'ya_existente', false);
END;
$$;

-- ── 5. Permisos de ejecución ─────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.aceptar_turno_planilla(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.solicitar_modificacion_planilla(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.aceptar_turno_planilla(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_modificacion_planilla(uuid, text) TO authenticated;

COMMIT;
