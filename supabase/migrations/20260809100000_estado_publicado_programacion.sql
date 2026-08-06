-- Bloque E — Estado Publicado para la programación mensual
--
-- Publicación de turnos ya programados: cambia únicamente turnos.publicado
-- (+ publicado_at, publicado_por). No crea ni elimina turnos, no toca
-- horarios, posiciones, vigiladores, asistencias, GPS ni horas.
--
-- publicar_turnos_programacion(p_objetivo_id, p_turno_ids, p_alcance):
--   · admin activo, o supervisor activo dentro de su alcance de zonas
--     (mismo modelo que asignar_vigilador_turnos: sin zonas = alcance
--     total; no se amplían permisos);
--   · valida POR TURNO sin abortar el lote: turno del objetivo indicado,
--     con obligación de cobertura (excluye reemplazado/anulado/cancelado —
--     estos dos últimos no son valores posibles hoy en turnos.estado, pero
--     se excluyen igual por si el CHECK constraint los habilita más
--     adelante), con posición operativa, con fecha/horario consistente;
--   · turnos ya publicados no se tocan de nuevo (idempotente, informativo);
--   · auditoría agregada en programacion_publicaciones (usuario, objetivo,
--     posiciones, cantidad de turnos publicados) — solo si se publicó al
--     menos uno.
--
-- Aditiva y reversible. No modifica datos existentes de turnos.

ALTER TABLE public.turnos ADD COLUMN IF NOT EXISTS publicado boolean NOT NULL DEFAULT false;
ALTER TABLE public.turnos ADD COLUMN IF NOT EXISTS publicado_at timestamptz;
ALTER TABLE public.turnos ADD COLUMN IF NOT EXISTS publicado_por uuid REFERENCES public.usuarios(id);

-- ── Auditoría agregada (una fila por operación de publicación) ─────────────
CREATE TABLE IF NOT EXISTS public.programacion_publicaciones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objetivo_id        uuid NOT NULL REFERENCES public.objetivos(id),
  usuario_id         uuid NOT NULL REFERENCES public.usuarios(id),
  auth_user_id       uuid NOT NULL,
  alcance            text,
  puesto_ids         uuid[] NOT NULL DEFAULT '{}',
  turno_ids          uuid[] NOT NULL DEFAULT '{}',
  cantidad_turnos    integer NOT NULL,
  cantidad_omitidos  integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_programacion_publicaciones_objetivo ON public.programacion_publicaciones (objetivo_id);

ALTER TABLE public.programacion_publicaciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'programacion_publicaciones'
      AND policyname = 'programacion_publicaciones_select'
  ) THEN
    CREATE POLICY programacion_publicaciones_select
      ON public.programacion_publicaciones FOR SELECT
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
                WHERE sz.supervisor_id = u.id AND o.id = programacion_publicaciones.objetivo_id
              )
            )
        )
      );
  END IF;
END $$;

REVOKE ALL ON public.programacion_publicaciones FROM anon;
GRANT SELECT ON public.programacion_publicaciones TO authenticated;

-- ── RPC: publicar ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publicar_turnos_programacion(
  p_objetivo_id uuid,
  p_turno_ids   uuid[],
  p_alcance     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid         uuid;
  v_actor       record;
  v_zonas       uuid[];
  v_objetivo    record;
  v_tid         uuid;
  v_turno       record;
  v_res         text;
  v_motivo      text;
  v_filas       jsonb := '[]'::jsonb;
  v_publicados  integer := 0;
  v_ya          integer := 0;
  v_omitidos    integer := 0;
  v_puesto_ids  uuid[] := '{}';
  v_turno_ids   uuid[] := '{}';
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id, rol INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la publicacion de programacion es de administracion o supervision';
  END IF;

  IF v_actor.rol = 'supervisor' THEN
    SELECT array_agg(zona_id) INTO v_zonas FROM public.supervisor_zonas WHERE supervisor_id = v_actor.id;
    -- v_zonas NULL = supervisor sin zonas = alcance total (regla existente).
  END IF;

  SELECT id, estado, zona_id INTO v_objetivo FROM public.objetivos WHERE id = p_objetivo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objetivo inexistente';
  END IF;
  IF v_actor.rol = 'supervisor' AND v_zonas IS NOT NULL AND NOT (v_objetivo.zona_id = ANY (v_zonas)) THEN
    RAISE EXCEPTION 'Objetivo fuera de la zona del supervisor';
  END IF;

  IF p_turno_ids IS NULL OR array_length(p_turno_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No hay turnos seleccionados';
  END IF;
  IF array_length(p_turno_ids, 1) > 1000 THEN
    RAISE EXCEPTION 'Demasiados turnos para una sola operacion (maximo 1000)';
  END IF;

  FOREACH v_tid IN ARRAY p_turno_ids LOOP
    v_res := 'omitido';
    v_motivo := NULL;
    BEGIN
      SELECT * INTO v_turno FROM public.turnos WHERE id = v_tid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno inexistente';
      END IF;
      IF v_turno.objetivo_id <> p_objetivo_id THEN
        RAISE EXCEPTION 'El turno no pertenece al objetivo indicado';
      END IF;

      IF v_turno.publicado THEN
        v_res := 'ya_publicado';
      ELSIF COALESCE(v_turno.estado, '') IN ('reemplazado', 'anulado', 'cancelado') THEN
        RAISE EXCEPTION 'Turno sin obligacion de cobertura';
      ELSIF v_turno.puesto_id IS NULL THEN
        RAISE EXCEPTION 'Turno sin posicion operativa';
      ELSIF v_turno.fecha IS NULL OR v_turno.hora_inicio IS NULL OR v_turno.hora_fin IS NULL
            OR v_turno.hora_inicio = v_turno.hora_fin THEN
        RAISE EXCEPTION 'Turno con datos inconsistentes';
      ELSE
        UPDATE public.turnos
        SET publicado = true, publicado_at = now(), publicado_por = v_actor.id
        WHERE id = v_turno.id;
        v_res := 'publicado';
        v_puesto_ids := array_append(v_puesto_ids, v_turno.puesto_id);
        v_turno_ids := array_append(v_turno_ids, v_turno.id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_res := 'omitido';
      v_motivo := SQLERRM;
    END;

    IF v_res = 'publicado' THEN v_publicados := v_publicados + 1;
    ELSIF v_res = 'ya_publicado' THEN v_ya := v_ya + 1;
    ELSE v_omitidos := v_omitidos + 1;
    END IF;

    v_filas := v_filas || jsonb_build_object('turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo);
  END LOOP;

  IF v_publicados > 0 THEN
    SELECT array_agg(DISTINCT x) INTO v_puesto_ids FROM unnest(v_puesto_ids) x;
    INSERT INTO public.programacion_publicaciones
      (objetivo_id, usuario_id, auth_user_id, alcance, puesto_ids, turno_ids, cantidad_turnos, cantidad_omitidos)
    VALUES (p_objetivo_id, v_actor.id, v_uid, p_alcance, v_puesto_ids, v_turno_ids, v_publicados, v_omitidos);
  END IF;

  RETURN jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'solicitados', array_length(p_turno_ids, 1),
    'publicados', v_publicados,
    'ya_publicados', v_ya,
    'omitidos', v_omitidos,
    'filas', v_filas
  );
END;
$BODY$;

REVOKE ALL ON FUNCTION public.publicar_turnos_programacion(uuid, uuid[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.publicar_turnos_programacion(uuid, uuid[], text) TO authenticated;
