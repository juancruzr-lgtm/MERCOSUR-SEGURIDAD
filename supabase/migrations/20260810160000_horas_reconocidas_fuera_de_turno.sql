-- Horas reconocidas: regularizacion humana por encima o por debajo del turno
--
-- corregir_registro_asistencia ya escribia los campos _final y auditaba cada
-- cambio en registros_asistencia_auditoria (quien, cuando, valor anterior,
-- valor nuevo, motivo, turno y registro). Lo que faltaba era poder reconocer un
-- horario que se sale de lo programado: el recalculo pasaba siempre por
-- calcular_horas_liquidables, que topea en el turno (LEAST(real, programado)).
--
-- Consecuencia: si el supervisor verificaba que el vigilador trabajo hasta las
-- 20:00 en un turno 07:00-19:00, la salida quedaba guardada pero las horas
-- liquidables seguian en 12. La aprobacion no llegaba a liquidacion.
--
-- Se agrega p_reconocer_fuera_de_turno (default false). Con el flag activo el
-- recalculo usa calcular_horas_reconocidas: el tramo aprobado exacto, sin tope
-- y sin la tolerancia de 15 minutos. Sirve en las dos direcciones (reconocer
-- mas o menos horas). Exige motivo y deja un renglon de auditoria propio.
--
-- NO reintroduce horas extra automaticas: sin el flag, el tope sigue rigiendo
-- exactamente igual, y el flag solo se activa desde una accion humana con
-- justificacion escrita. El fichaje por si solo nunca aumenta las horas.
--
-- Mismo patron que ya usa cerrar_turno, la otra RPC autorizada a reconocer mas
-- horas que las programadas: aritmetica propia en vez de la funcion topeada.
--
-- DROP + CREATE en corregir_registro_asistencia porque cambia la lista de
-- parametros: con CREATE OR REPLACE quedarian dos funciones sobrecargadas y
-- PostgREST no sabria cual llamar.

-- ── Tramo aprobado, sin tope ────────────────────────────────────────────────
-- Misma aritmetica que calcular_horas_liquidables (incluido el manejo de turnos
-- nocturnos), pero devuelve la duracion real del tramo: ni LEAST contra lo
-- programado, ni el redondeo por tolerancia. Lo que el supervisor aprueba es lo
-- que se reconoce.

create or replace function public.calcular_horas_reconocidas(
  p_hora_inicio time,
  p_hora_fin    time,
  p_entrada     time,
  p_salida      time
)
returns numeric(6,2)
language plpgsql
immutable
as $fn$
declare
  v_inicio_min     int;
  v_fin_min        int;
  v_entrada_min    int;
  v_salida_min     int;
  v_turno_nocturno bool;
  v_entrada_abs    int;
  v_salida_abs     int;
  v_min_reales     int;
begin
  if p_hora_inicio is null or p_hora_fin is null
     or p_entrada is null or p_salida is null
  then
    return null;
  end if;

  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;

  v_turno_nocturno := v_fin_min <= v_inicio_min;

  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then
    v_entrada_abs := v_entrada_abs + 1440;
  end if;

  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then
    v_salida_abs := v_salida_abs + 1440;
  end if;
  if v_salida_abs < v_entrada_abs then
    v_salida_abs := v_salida_abs + 1440;
  end if;

  v_min_reales := greatest(0, v_salida_abs - v_entrada_abs);

  return round(cast(v_min_reales as numeric) / 60.0, 2);
end;
$fn$;

-- ── corregir_registro_asistencia con el parametro nuevo ─────────────────────

DROP FUNCTION IF EXISTS public.corregir_registro_asistencia(uuid, jsonb, text);
CREATE OR REPLACE FUNCTION public.corregir_registro_asistencia(
  p_registro_id uuid,
  p_payload     jsonb,
  p_comentario  text,
  p_reconocer_fuera_de_turno boolean DEFAULT false
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

  -- ── 2 bis. Reconocer fuera del turno exige motivo ────────────────────────
  --     Es lo unico que autoriza a superar la duracion programada (o a quedar
  --     por debajo sin la tolerancia), asi que no puede ir sin justificacion.
  IF p_reconocer_fuera_de_turno AND COALESCE(btrim(p_comentario), '') = '' THEN
    RAISE EXCEPTION 'Reconocer un horario fuera del turno programado requiere un motivo';
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
  v_after_horas_liquidables  := CASE
    WHEN p_reconocer_fuera_de_turno
      THEN public.calcular_horas_reconocidas(v_hora_inicio, v_hora_fin, v_entrada_eff, v_salida_eff)
      ELSE public.calcular_horas_liquidables(v_hora_inicio, v_hora_fin, v_entrada_eff, v_salida_eff)
  END;

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

  -- Rastro explicito de que alguien autorizo salirse del turno programado,
  -- aunque las horas resultantes coincidan con las que habria dado el tope.
  IF p_reconocer_fuera_de_turno THEN
    INSERT INTO public.registros_asistencia_auditoria
      (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
    VALUES (
      p_registro_id, v_turno_id, v_modificado_por,
      'reconocido_fuera_de_turno', null, 'true', p_comentario
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
REVOKE EXECUTE ON FUNCTION public.corregir_registro_asistencia(uuid, jsonb, text, boolean)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.corregir_registro_asistencia(uuid, jsonb, text, boolean)
  FROM anon;

-- La autorizacion real (admin/supervisor activo) se valida dentro de la funcion.
GRANT EXECUTE ON FUNCTION public.corregir_registro_asistencia(uuid, jsonb, text, boolean)
  TO authenticated;
