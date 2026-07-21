-- ════════════════════════════════════════════════════════════════════
-- 20260721_rpc_corregir_registro.sql
--
-- RPC transaccional para corregir campos _final de un registro de asistencia.
--
-- Garantías:
--   · UPDATE + INSERT auditoría ocurren en la misma transacción PG.
--   · Si cualquiera falla, ninguna persiste (rollback automático).
--
-- Seguridad:
--   · SECURITY DEFINER con SET search_path = public, pg_catalog.
--     Justificación: la RLS de registros_asistencia solo concede UPDATE a
--     'admin'; el rol 'supervisor' solo tiene SELECT. Como el supervisor
--     tiene legitimidad operativa para corregir registros, la función corre
--     como el propietario (postgres) y aplica su propio control de acceso
--     interno, más restrictivo que RLS, en lugar de extender la policy de RLS.
--     Todas las tablas se califican con esquema (public.*) para evitar
--     search_path injection.
--
-- Firma (3 parámetros — sin identidad ni auditoría fabricada desde React):
--   p_registro_id  uuid   — ID del registro a corregir
--   p_payload      jsonb  — {guardia_final_id?, objetivo_final_id?,
--                            hora_entrada_final?, hora_salida_final?,
--                            comentario_final?}
--   p_comentario   text   — comentario del supervisor (nullable)
--
-- Idempotente: CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.corregir_registro_asistencia(
  p_registro_id uuid,
  p_payload     jsonb,
  p_comentario  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid                       uuid;
  v_modificado_por            uuid;
  v_turno_id                  uuid;
  v_hora_inicio               time;
  v_hora_fin                  time;
  v_entrada_real              time;
  v_salida_real               time;
  v_entrada_eff               time;
  v_salida_eff                time;
  v_rows                      int;
  -- Valores "before" leídos desde la fila bloqueada
  v_before_guardia_final_id   uuid;
  v_before_objetivo_final_id  uuid;
  v_before_hora_entrada_final time;
  v_before_hora_salida_final  time;
  v_before_comentario_final   text;
  v_before_horas_liquidables  numeric;
  -- Valores "after" computados internamente
  v_after_guardia_final_id    uuid;
  v_after_objetivo_final_id   uuid;
  v_after_hora_entrada_final  time;
  v_after_hora_salida_final   time;
  v_after_comentario_final    text;
  v_after_horas_liquidables   numeric;
  -- Iteración para validar claves del payload
  v_key                       text;
  v_allowed_keys              text[] := ARRAY[
    'guardia_final_id',
    'objetivo_final_id',
    'hora_entrada_final',
    'hora_salida_final',
    'comentario_final'
  ];
BEGIN

  -- ── 1. Verificar que hay sesión autenticada ───────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

  -- ── 2. Verificar autorización: admin o supervisor, estado activo ──────────
  --    No se confía en RLS para autorizar el UPDATE; se valida aquí de forma
  --    explícita. jefe_operativo no está habilitado (no existe en producción).
  SELECT id
  INTO v_modificado_por
  FROM public.usuarios
  WHERE auth_user_id = v_uid
    AND estado       = 'activo'
    AND rol          IN ('admin', 'supervisor');

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No autorizado: se requiere rol admin o supervisor con estado activo';
  END IF;

  -- ── 3. Validar que p_payload no contenga claves no permitidas ────────────
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'Clave no permitida en payload: "%"', v_key;
    END IF;
  END LOOP;

  -- ── 4. Bloquear el registro y leer valores previos (FOR UPDATE) ───────────
  SELECT
    ra.turno_id,
    t.hora_inicio,
    t.hora_fin,
    ra.hora_entrada_real,
    ra.hora_salida_real,
    ra.guardia_final_id,
    ra.objetivo_final_id,
    ra.hora_entrada_final,
    ra.hora_salida_final,
    ra.comentario_final,
    ra.horas_liquidables
  INTO
    v_turno_id,
    v_hora_inicio,
    v_hora_fin,
    v_entrada_real,
    v_salida_real,
    v_before_guardia_final_id,
    v_before_objetivo_final_id,
    v_before_hora_entrada_final,
    v_before_hora_salida_final,
    v_before_comentario_final,
    v_before_horas_liquidables
  FROM public.registros_asistencia ra
  JOIN public.turnos t ON t.id = ra.turno_id
  WHERE ra.id = p_registro_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Registro % no encontrado o su turno no existe', p_registro_id;
  END IF;

  -- ── 5. Validar existencia de guardia_final_id si se provee ───────────────
  IF (p_payload->>'guardia_final_id') IS NOT NULL
     AND (p_payload->>'guardia_final_id') <> ''
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = (p_payload->>'guardia_final_id')::uuid
    ) THEN
      RAISE EXCEPTION
        'guardia_final_id no existe: %', p_payload->>'guardia_final_id';
    END IF;
  END IF;

  -- ── 6. Validar existencia de objetivo_final_id si se provee ──────────────
  IF (p_payload->>'objetivo_final_id') IS NOT NULL
     AND (p_payload->>'objetivo_final_id') <> ''
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.objetivos
      WHERE id = (p_payload->>'objetivo_final_id')::uuid
    ) THEN
      RAISE EXCEPTION
        'objetivo_final_id no existe: %', p_payload->>'objetivo_final_id';
    END IF;
  END IF;

  -- ── 7. Calcular horas efectivas post-corrección ───────────────────────────
  --    NULLIF convierte string vacío en NULL (defensivo ante envíos de React).
  v_entrada_eff := COALESCE(
    NULLIF(p_payload->>'hora_entrada_final', '')::time,
    v_entrada_real
  );
  v_salida_eff := COALESCE(
    NULLIF(p_payload->>'hora_salida_final', '')::time,
    v_salida_real
  );

  -- ── 8. Calcular valores "after" para la auditoría ────────────────────────
  v_after_guardia_final_id   := NULLIF(p_payload->>'guardia_final_id',   '')::uuid;
  v_after_objetivo_final_id  := NULLIF(p_payload->>'objetivo_final_id',  '')::uuid;
  v_after_hora_entrada_final := NULLIF(p_payload->>'hora_entrada_final', '')::time;
  v_after_hora_salida_final  := NULLIF(p_payload->>'hora_salida_final',  '')::time;
  v_after_comentario_final   := NULLIF(p_payload->>'comentario_final',   '');
  v_after_horas_liquidables  := public.calcular_horas_liquidables(
    v_hora_inicio, v_hora_fin, v_entrada_eff, v_salida_eff
  );

  -- ── 9. UPDATE — solo toca campos _final y horas_liquidables ──────────────
  --    Nunca modifica guardia_id, hora_entrada_real, hora_salida_real ni GPS.
  UPDATE public.registros_asistencia
  SET
    guardia_final_id   = v_after_guardia_final_id,
    objetivo_final_id  = v_after_objetivo_final_id,
    hora_entrada_final = v_after_hora_entrada_final,
    hora_salida_final  = v_after_hora_salida_final,
    comentario_final   = v_after_comentario_final,
    horas_liquidables  = v_after_horas_liquidables
  WHERE id = p_registro_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION
      'UPDATE afectó % filas para registro %; se esperaba exactamente 1',
      v_rows, p_registro_id;
  END IF;

  -- ── 10. Construir auditoría comparando before vs after ───────────────────
  --     Fuente de verdad: valores leídos de la DB en el paso 4 (before) y
  --     computados internamente (after). El frontend no puede falsificar
  --     campo, valor_anterior ni valor_nuevo.

  IF v_before_guardia_final_id IS DISTINCT FROM v_after_guardia_final_id THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      p_registro_id, v_turno_id, v_modificado_por,
      'guardia_final_id',
      v_before_guardia_final_id::text,
      v_after_guardia_final_id::text,
      p_comentario
    );
  END IF;

  IF v_before_objetivo_final_id IS DISTINCT FROM v_after_objetivo_final_id THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      p_registro_id, v_turno_id, v_modificado_por,
      'objetivo_final_id',
      v_before_objetivo_final_id::text,
      v_after_objetivo_final_id::text,
      p_comentario
    );
  END IF;

  IF v_before_hora_entrada_final IS DISTINCT FROM v_after_hora_entrada_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      p_registro_id, v_turno_id, v_modificado_por,
      'hora_entrada_final',
      v_before_hora_entrada_final::text,
      v_after_hora_entrada_final::text,
      p_comentario
    );
  END IF;

  IF v_before_hora_salida_final IS DISTINCT FROM v_after_hora_salida_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      p_registro_id, v_turno_id, v_modificado_por,
      'hora_salida_final',
      v_before_hora_salida_final::text,
      v_after_hora_salida_final::text,
      p_comentario
    );
  END IF;

  IF v_before_comentario_final IS DISTINCT FROM v_after_comentario_final THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      p_registro_id, v_turno_id, v_modificado_por,
      'comentario_final',
      v_before_comentario_final,
      v_after_comentario_final,
      p_comentario
    );
  END IF;

  IF v_before_horas_liquidables IS DISTINCT FROM v_after_horas_liquidables THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      p_registro_id, v_turno_id, v_modificado_por,
      'horas_liquidables',
      v_before_horas_liquidables::text,
      v_after_horas_liquidables::text,
      p_comentario
    );
  END IF;

END;
$$;

-- Revocar el permiso por defecto que PostgreSQL concede a PUBLIC al crear
-- cualquier función. Sin este REVOKE, anon (que hereda de PUBLIC) podría
-- invocar la función aunque auth.uid() devuelva NULL y la función la rechace.
-- La defensa correcta es impedir que llegue al cuerpo.
REVOKE EXECUTE ON FUNCTION public.corregir_registro_asistencia(uuid, jsonb, text)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.corregir_registro_asistencia(uuid, jsonb, text)
  FROM anon;

-- Solo usuarios autenticados pueden ejecutar la función.
-- La autorización real (admin/supervisor activo) se valida dentro de la función.
GRANT EXECUTE ON FUNCTION public.corregir_registro_asistencia(uuid, jsonb, text)
  TO authenticated;
