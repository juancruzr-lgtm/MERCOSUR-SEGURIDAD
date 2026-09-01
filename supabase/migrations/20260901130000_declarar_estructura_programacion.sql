-- Lógica detectada — Declaración TRANSACCIONAL de estructura en servicios_objetivo
--
-- La pantalla "Lógica detectada" confirmaba un plan (crear turnos base,
-- crear servicios, actualizar días, desactivar franjas) y lo ejecutaba con
-- varias escrituras secuenciales desde el cliente: una falla a mitad de
-- camino podía dejar configuración a medias. Esta RPC aplica el plan
-- completo en UNA transacción: o entra todo, o no entra nada.
--
-- Reutiliza la arquitectura existente, no inventa otra:
--   · mismo esqueleto que vincular_servicio_puesto y
--     crear_turnos_programacion_parcial (SECURITY DEFINER, admin activo,
--     validaciones en servidor, advisory lock);
--   · misma tabla de auditoría servicios_objetivo_auditoria, extendiendo
--     su CHECK de accion con las acciones de declaración (cada escritura
--     queda auditada en la MISMA transacción).
--
-- La RPC declara SOLO configuración: jamás crea turnos. Es tolerante a la
-- repetición: un servicio idéntico ya activo no se duplica (ya_declarado)
-- y desactivar un servicio ya inactivo no es error.
--
-- Aditiva y reversible (rollback en archivo aparte).

-- 1) Auditoría: nuevas acciones de declaración. puesto_id_nuevo pasa a ser
--    opcional porque un servicio legacy actualizado/desactivado puede no
--    tener puesto vinculado todavía.
ALTER TABLE public.servicios_objetivo_auditoria
  ALTER COLUMN puesto_id_nuevo DROP NOT NULL;

ALTER TABLE public.servicios_objetivo_auditoria
  DROP CONSTRAINT IF EXISTS servicios_objetivo_auditoria_accion_check;

ALTER TABLE public.servicios_objetivo_auditoria
  ADD CONSTRAINT servicios_objetivo_auditoria_accion_check
  CHECK (accion IN (
    'vincular_puesto',
    'declarar_servicio_creado',
    'declarar_dias_actualizados',
    'declarar_servicio_desactivado'
  ));

-- 2) RPC de declaración atómica.
CREATE OR REPLACE FUNCTION public.declarar_estructura_programacion(
  p_objetivo_id           uuid,
  p_crear_turnos_base     jsonb DEFAULT '[]'::jsonb, -- [{nombre, hora_inicio, hora_fin}]
  p_crear_servicios       jsonb DEFAULT '[]'::jsonb, -- [{puesto_id, hora_inicio, hora_fin, turno_base_id|null, dias_semana}]
  p_actualizar_dias       jsonb DEFAULT '[]'::jsonb, -- [{servicio_id, dias_semana}]
  p_desactivar_servicios  jsonb DEFAULT '[]'::jsonb  -- [servicio_id, ...]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $BODY$
DECLARE
  v_uid            uuid;
  v_actor          uuid;
  v_objetivo       record;
  v_item           jsonb;
  v_hi             time;
  v_hf             time;
  v_tb_id          uuid;
  v_mapa_tb        jsonb := '{}'::jsonb;
  v_puesto         record;
  v_servicio       record;
  v_dias           integer[];
  v_d              integer;
  v_nuevo_id       uuid;
  v_tb_creados     integer := 0;
  v_tb_reusados    integer := 0;
  v_creados        integer := 0;
  v_ya_declarados  integer := 0;
  v_actualizados   integer := 0;
  v_desactivados   integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol = 'admin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la declaracion de estructura es exclusiva de administracion';
  END IF;

  IF p_objetivo_id IS NULL THEN
    RAISE EXCEPTION 'objetivo_id requerido';
  END IF;
  SELECT id, estado, es_prueba INTO v_objetivo
  FROM public.objetivos WHERE id = p_objetivo_id;
  IF NOT FOUND OR v_objetivo.estado <> 'activo' THEN
    RAISE EXCEPTION 'Objetivo inexistente o inactivo';
  END IF;
  IF v_objetivo.es_prueba THEN
    RAISE EXCEPTION 'Objetivo de prueba excluido de la programacion';
  END IF;

  IF jsonb_typeof(p_crear_turnos_base) <> 'array'
    OR jsonb_typeof(p_crear_servicios) <> 'array'
    OR jsonb_typeof(p_actualizar_dias) <> 'array'
    OR jsonb_typeof(p_desactivar_servicios) <> 'array' THEN
    RAISE EXCEPTION 'Formato invalido: se esperan arreglos';
  END IF;
  IF jsonb_array_length(p_crear_servicios) + jsonb_array_length(p_actualizar_dias)
     + jsonb_array_length(p_desactivar_servicios) = 0 THEN
    RAISE EXCEPTION 'Nada para declarar';
  END IF;
  IF jsonb_array_length(p_crear_turnos_base) > 50
    OR jsonb_array_length(p_crear_servicios) > 100
    OR jsonb_array_length(p_actualizar_dias) > 100
    OR jsonb_array_length(p_desactivar_servicios) > 100 THEN
    RAISE EXCEPTION 'Demasiadas operaciones para una sola declaracion';
  END IF;

  -- Declaraciones concurrentes sobre el mismo objetivo se serializan.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_objetivo_id::text, 0));

  -- Turnos base: se reutiliza el activo de la misma franja si ya existe.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_crear_turnos_base) LOOP
    v_hi := (v_item->>'hora_inicio')::time;
    v_hf := (v_item->>'hora_fin')::time;
    IF v_hi IS NULL OR v_hf IS NULL OR v_hi = v_hf THEN
      RAISE EXCEPTION 'Franja horaria invalida en turnos base';
    END IF;
    SELECT id INTO v_tb_id
    FROM public.turnos_base
    WHERE activo AND hora_inicio = v_hi AND hora_fin = v_hf
    ORDER BY created_at LIMIT 1;
    IF FOUND THEN
      v_tb_reusados := v_tb_reusados + 1;
    ELSE
      INSERT INTO public.turnos_base (nombre, hora_inicio, hora_fin, activo)
      VALUES (COALESCE(NULLIF(v_item->>'nombre', ''), to_char(v_hi,'HH24:MI') || '-' || to_char(v_hf,'HH24:MI')), v_hi, v_hf, true)
      RETURNING id INTO v_tb_id;
      v_tb_creados := v_tb_creados + 1;
    END IF;
    v_mapa_tb := v_mapa_tb || jsonb_build_object(to_char(v_hi,'HH24:MI') || '|' || to_char(v_hf,'HH24:MI'), v_tb_id::text);
  END LOOP;

  -- Servicios nuevos.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_crear_servicios) LOOP
    v_hi := (v_item->>'hora_inicio')::time;
    v_hf := (v_item->>'hora_fin')::time;
    v_tb_id := COALESCE(
      (v_item->>'turno_base_id')::uuid,
      (v_mapa_tb->>(to_char(v_hi,'HH24:MI') || '|' || to_char(v_hf,'HH24:MI')))::uuid);
    IF v_tb_id IS NULL THEN
      RAISE EXCEPTION 'Franja %-% sin turno base resuelto', to_char(v_hi,'HH24:MI'), to_char(v_hf,'HH24:MI');
    END IF;
    PERFORM 1 FROM public.turnos_base tb
    WHERE tb.id = v_tb_id AND tb.activo AND tb.hora_inicio = v_hi AND tb.hora_fin = v_hf;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El turno base no coincide con la franja declarada';
    END IF;

    SELECT id, objetivo_id, activo INTO v_puesto
    FROM public.puestos WHERE id = (v_item->>'puesto_id')::uuid;
    IF NOT FOUND OR v_puesto.objetivo_id <> p_objetivo_id OR NOT v_puesto.activo THEN
      RAISE EXCEPTION 'Puesto inexistente, inactivo o de otro objetivo';
    END IF;

    SELECT array_agg(value::integer) INTO v_dias
    FROM jsonb_array_elements_text(v_item->'dias_semana');
    IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN
      RAISE EXCEPTION 'Servicio sin dias de la semana';
    END IF;
    FOREACH v_d IN ARRAY v_dias LOOP
      IF v_d < 1 OR v_d > 7 THEN
        RAISE EXCEPTION 'Dia de semana invalido: %', v_d;
      END IF;
    END LOOP;

    -- Repetir la declaracion no duplica: mismo objetivo + puesto + turno
    -- base activo ya declarado cuenta como existente.
    PERFORM 1 FROM public.servicios_objetivo s
    WHERE s.objetivo_id = p_objetivo_id AND s.activo
      AND s.puesto_id = v_puesto.id AND s.turno_base_id = v_tb_id;
    IF FOUND THEN
      v_ya_declarados := v_ya_declarados + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.servicios_objetivo (
      objetivo_id, puesto_id, turno_base_id, dias_semana, guardia_habitual_id, activo
    ) VALUES (
      p_objetivo_id, v_puesto.id, v_tb_id, v_dias, NULL, true
    ) RETURNING id INTO v_nuevo_id;
    v_creados := v_creados + 1;

    INSERT INTO public.servicios_objetivo_auditoria (
      servicio_id, usuario_id, auth_user_id, accion, puesto_id_anterior, puesto_id_nuevo
    ) VALUES (v_nuevo_id, v_actor, v_uid, 'declarar_servicio_creado', NULL, v_puesto.id);
  END LOOP;

  -- Dias actualizados (dias_diferentes resuelto a favor del historico).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_actualizar_dias) LOOP
    SELECT id, objetivo_id, puesto_id, activo INTO v_servicio
    FROM public.servicios_objetivo
    WHERE id = (v_item->>'servicio_id')::uuid
    FOR UPDATE;
    IF NOT FOUND OR v_servicio.objetivo_id <> p_objetivo_id THEN
      RAISE EXCEPTION 'Servicio a actualizar inexistente o de otro objetivo';
    END IF;
    IF NOT v_servicio.activo THEN
      RAISE EXCEPTION 'No se actualizan dias de un servicio inactivo';
    END IF;

    SELECT array_agg(value::integer) INTO v_dias
    FROM jsonb_array_elements_text(v_item->'dias_semana');
    IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN
      RAISE EXCEPTION 'Actualizacion sin dias de la semana';
    END IF;
    FOREACH v_d IN ARRAY v_dias LOOP
      IF v_d < 1 OR v_d > 7 THEN
        RAISE EXCEPTION 'Dia de semana invalido: %', v_d;
      END IF;
    END LOOP;

    UPDATE public.servicios_objetivo SET dias_semana = v_dias WHERE id = v_servicio.id;
    v_actualizados := v_actualizados + 1;

    INSERT INTO public.servicios_objetivo_auditoria (
      servicio_id, usuario_id, auth_user_id, accion, puesto_id_anterior, puesto_id_nuevo
    ) VALUES (v_servicio.id, v_actor, v_uid, 'declarar_dias_actualizados', v_servicio.puesto_id, v_servicio.puesto_id);
  END LOOP;

  -- Franjas desactivadas (horario_diferente resuelto a favor del historico).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_desactivar_servicios) LOOP
    SELECT id, objetivo_id, puesto_id, activo INTO v_servicio
    FROM public.servicios_objetivo
    WHERE id = (v_item #>> '{}')::uuid
    FOR UPDATE;
    IF NOT FOUND OR v_servicio.objetivo_id <> p_objetivo_id THEN
      RAISE EXCEPTION 'Servicio a desactivar inexistente o de otro objetivo';
    END IF;
    IF NOT v_servicio.activo THEN
      CONTINUE; -- ya estaba inactivo: repetir la declaracion no es error
    END IF;

    UPDATE public.servicios_objetivo SET activo = false WHERE id = v_servicio.id;
    v_desactivados := v_desactivados + 1;

    INSERT INTO public.servicios_objetivo_auditoria (
      servicio_id, usuario_id, auth_user_id, accion, puesto_id_anterior, puesto_id_nuevo
    ) VALUES (v_servicio.id, v_actor, v_uid, 'declarar_servicio_desactivado', v_servicio.puesto_id, v_servicio.puesto_id);
  END LOOP;

  RETURN jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'turnos_base_creados', v_tb_creados,
    'turnos_base_reusados', v_tb_reusados,
    'servicios_creados', v_creados,
    'servicios_ya_declarados', v_ya_declarados,
    'servicios_actualizados', v_actualizados,
    'servicios_desactivados', v_desactivados
  );
END;
$BODY$;

REVOKE ALL ON FUNCTION public.declarar_estructura_programacion(uuid, jsonb, jsonb, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.declarar_estructura_programacion(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;
