-- Bloque E (commit 4) — Creación parcial de turnos desde la vista previa
--
-- Regla aprobada: la programación crea el servicio; el supervisor asigna el
-- vigilador después. Los turnos se crean SIEMPRE con guardia_id NULL y
-- guardia_original_id NULL, estado 'programado', tipo_evento 'normal'.
--
-- Única vía de escritura de este flujo: RPC crear_turnos_programacion_parcial.
--   · solo administración activa (auth.uid() → usuarios.rol='admin');
--   · revalida CADA fila en servidor (no confía en la vista previa):
--     servicio activo, objetivo activo y no de prueba, puesto activo del
--     objetivo, turno base activo, fecha dentro del mes y del día de semana
--     del servicio, y ausencia de turno equivalente vigente;
--   · deduplicación sin depender del vigilador, misma prioridad que el
--     helper previsualizarMes: (1) servicio_base_id + fecha + horario +
--     puesto; (2) fallback objetivo + puesto + fecha + horario. Turnos en
--     estados sin obligación (reemplazado/anulado/cancelado) no cuentan;
--   · una fila inválida se omite con su motivo, sin abortar el lote;
--   · idempotente por operacion_id: repetir con el mismo payload devuelve
--     el resultado guardado; reusar el id con otro payload es un error;
--   · auditoría por operación en generacion_turnos_auditoria (INSERT only,
--     nunca UPDATE): payload original, resultado por fila, IDs creados.
--
-- Aditiva, idempotente, reversible. No modifica turnos existentes.

CREATE TABLE IF NOT EXISTS public.generacion_turnos_auditoria (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id         uuid NOT NULL UNIQUE,
  usuario_id           uuid NOT NULL REFERENCES public.usuarios(id),
  auth_user_id         uuid NOT NULL,
  mes                  text NOT NULL,
  payload              jsonb NOT NULL,
  payload_hash         text NOT NULL,
  filas_solicitadas    integer NOT NULL,
  filas_creadas        integer NOT NULL,
  filas_ya_existentes  integer NOT NULL,
  filas_omitidas       integer NOT NULL,
  turnos_creados       uuid[] NOT NULL DEFAULT '{}',
  resultado            jsonb NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generacion_turnos_auditoria_mes
  ON public.generacion_turnos_auditoria (mes);

ALTER TABLE public.generacion_turnos_auditoria ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'generacion_turnos_auditoria'
      AND policyname = 'generacion_turnos_auditoria_select'
  ) THEN
    CREATE POLICY generacion_turnos_auditoria_select
      ON public.generacion_turnos_auditoria FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.usuarios u
        WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo'
          AND u.rol IN ('admin', 'supervisor')
      ));
  END IF;
END $$;

REVOKE ALL ON public.generacion_turnos_auditoria FROM anon;
GRANT SELECT ON public.generacion_turnos_auditoria TO authenticated;

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
  v_actor      uuid;
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

  SELECT id INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la generacion de turnos es exclusiva de administracion';
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

  -- Idempotencia por operación. El lock serializa reintentos concurrentes
  -- del mismo operacion_id.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));
  v_hash := md5(p_mes || '|' || p_filas::text);
  SELECT payload_hash, resultado INTO v_previa
  FROM public.generacion_turnos_auditoria
  WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_previa.payload_hash = v_hash THEN
      RETURN v_previa.resultado || jsonb_build_object('repetida', true);
    END IF;
    RAISE EXCEPTION 'La operacion ya fue ejecutada con otro contenido: iniciá una operacion nueva';
  END IF;

  v_desde := to_date(p_mes || '-01', 'YYYY-MM-DD');
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;

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

      v_dow := EXTRACT(ISODOW FROM v_fecha);
      IF v_servicio.dias_semana IS NULL OR NOT (v_dow = ANY (v_servicio.dias_semana)) THEN
        RAISE EXCEPTION 'El dia no corresponde a los dias del servicio';
      END IF;

      -- Turno equivalente vigente: misma prioridad que la vista previa.
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
    p_operacion_id, v_actor, v_uid, p_mes, p_filas, v_hash,
    jsonb_array_length(p_filas), v_creadas, v_ya, v_omitidas,
    v_creados, v_resultado
  );

  RETURN v_resultado;
END;
$BODY$;

REVOKE ALL ON FUNCTION public.crear_turnos_programacion_parcial(uuid, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crear_turnos_programacion_parcial(uuid, text, jsonb) TO authenticated;
