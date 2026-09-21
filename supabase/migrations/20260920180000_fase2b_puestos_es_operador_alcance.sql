-- ============================================================================
-- FASE 2B — Puestos: desacoplar las RPC de posiciones operativas del rol='admin'
-- ============================================================================
--
-- JC (20/09): las 4 RPC SECURITY DEFINER de gestión de puestos
-- (crear/editar/duplicar/eliminar_posicion_operativa) autorizaban SOLO por
-- usuarios.rol='admin' (bypass de la RLS correcta de la tabla puestos). Se
-- reemplaza ESE gate (y sólo ese) por la autorización moderna, que representa
-- exactamente la regla definitiva:
--   · Vigilador                → NO (es_operador_actual = false).
--   · Supervisor               → SÍ, sólo dentro de SUS zonas (alcanza_objetivo_actual).
--   · jefe_supervisores (Aldo) → SÍ, todos los objetivos.
--   · direccion_operativa      → SÍ, todos.
--   · Administración           → SÍ, todos.
--   · Gerencia                 → SÍ, todos.
--   · Sergio (acceso_admin_pleno) → SÍ, todos (alcance 'todas').
--
-- Cambio en cada función (lo demás — validaciones, guardas de desactivación/
-- borrado, dedupe, auditoría por-campo — se conserva IDÉNTICO al original):
--   (a) Gate: se quita el filtro `AND rol='admin'` del SELECT del actor y su
--       excepción; v_actor pasa a ser el id del usuario activo actual (para la
--       auditoría). Se agrega `IF NOT es_operador_actual() -> excepción`.
--   (b) Alcance: `IF NOT alcanza_objetivo_actual(<objetivo_id>) -> excepción`,
--       con objetivo_id = p_objetivo_id (crear) o DERIVADO del puesto
--       (v_actual.objetivo_id / v_origen.objetivo_id) en editar/duplicar/eliminar,
--       validado ANTES de escribir.
--
-- La RLS de la tabla puestos ya es por alcance (puestos_insert/update/delete_alcance
-- con alcanza_objetivo_actual) y NO se toca. No toca UI de servidor, ni
-- Supervisiones, ni otros gates. Crons/servidor usan service_role (bypass RLS).
--
-- ROLLBACK: supabase/rollback/20260920180000_fase2b_puestos_es_operador_alcance_rollback.sql
-- Idempotente: sí (create or replace).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) CREAR
-- ----------------------------------------------------------------------------
create or replace function public.crear_posicion_operativa(
  p_objetivo_id uuid,
  p_nombre text,
  p_orden integer default null::integer,
  p_observacion text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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

  -- Gate moderno (reemplaza rol='admin'): actor operativo válido.
  SELECT id INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no activo';
  END IF;
  IF NOT public.es_operador_actual() THEN
    RAISE EXCEPTION 'No autorizado para gestionar posiciones operativas';
  END IF;

  SELECT id, estado INTO v_objetivo FROM public.objetivos WHERE id = p_objetivo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Objetivo inexistente';
  END IF;
  IF v_objetivo.estado <> 'activo' THEN
    RAISE EXCEPTION 'El objetivo no esta activo';
  END IF;

  -- Alcance: supervisor sólo dentro de sus zonas; jefe/dir_op/admin/gerencia todas.
  IF NOT public.alcanza_objetivo_actual(p_objetivo_id) THEN
    RAISE EXCEPTION 'El objetivo esta fuera de tu alcance';
  END IF;

  v_nombre := trim(p_nombre);
  IF v_nombre = '' OR v_nombre IS NULL THEN
    RAISE EXCEPTION 'El nombre de la posicion es obligatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.puestos p
    WHERE p.objetivo_id = p_objetivo_id
      AND p.activo
      AND lower(regexp_replace(trim(p.nombre), '\s+', ' ', 'g')) =
          lower(regexp_replace(v_nombre, '\s+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'Ya existe una posicion operativa activa con ese nombre en este objetivo';
  END IF;

  v_orden := p_orden;
  IF v_orden IS NULL THEN
    SELECT COALESCE(MAX(orden), 0) + 1 INTO v_orden
    FROM public.puestos WHERE objetivo_id = p_objetivo_id;
  END IF;

  INSERT INTO public.puestos (objetivo_id, nombre, activo, orden, observacion)
  VALUES (p_objetivo_id, v_nombre, true, v_orden, NULLIF(trim(COALESCE(p_observacion, '')), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.puestos_auditoria
    (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, valor_nuevo, motivo)
  VALUES
    (v_id, p_objetivo_id, v_nombre, v_actor, v_uid, 'crear', v_nombre, p_observacion);

  SELECT to_jsonb(p) INTO v_resultado FROM public.puestos p WHERE p.id = v_id;
  RETURN v_resultado;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) EDITAR
-- ----------------------------------------------------------------------------
create or replace function public.editar_posicion_operativa(
  p_id uuid,
  p_nombre text default null::text,
  p_orden integer default null::integer,
  p_observacion text default null::text,
  p_activo boolean default null::boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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

  -- Gate moderno (reemplaza rol='admin'): actor operativo válido.
  SELECT id INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no activo';
  END IF;
  IF NOT public.es_operador_actual() THEN
    RAISE EXCEPTION 'No autorizado para gestionar posiciones operativas';
  END IF;

  SELECT id, objetivo_id, nombre, orden, observacion, activo
    INTO v_actual
  FROM public.puestos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa inexistente';
  END IF;

  -- Alcance derivado del puesto.
  IF NOT public.alcanza_objetivo_actual(v_actual.objetivo_id) THEN
    RAISE EXCEPTION 'El puesto esta fuera de tu alcance';
  END IF;

  v_nombre_final := COALESCE(NULLIF(trim(p_nombre), ''), v_actual.nombre);
  IF p_nombre IS NOT NULL AND trim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre de la posicion es obligatorio';
  END IF;

  IF (v_nombre_final IS DISTINCT FROM v_actual.nombre
      OR (p_activo IS TRUE AND NOT v_actual.activo))
     AND COALESCE(p_activo, v_actual.activo) THEN
    IF EXISTS (
      SELECT 1 FROM public.puestos p
      WHERE p.objetivo_id = v_actual.objetivo_id
        AND p.activo
        AND p.id <> p_id
        AND lower(regexp_replace(trim(p.nombre), '\s+', ' ', 'g')) =
            lower(regexp_replace(v_nombre_final, '\s+', ' ', 'g'))
    ) THEN
      RAISE EXCEPTION 'Ya existe una posicion operativa activa con ese nombre en este objetivo';
    END IF;
  END IF;

  IF p_activo IS FALSE AND v_actual.activo THEN
    v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
    v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;
    SELECT count(*) INTO v_turnos_fut
    FROM public.turnos t
    WHERE t.puesto_id = p_id
      AND t.estado <> 'reemplazado'
      AND (t.fecha > v_hoy_arg OR (t.fecha = v_hoy_arg AND t.hora_inicio > v_hora_arg));
    SELECT count(*) INTO v_servicios
    FROM public.servicios_objetivo s
    WHERE s.puesto_id = p_id AND s.activo;
    IF v_turnos_fut > 0 OR v_servicios > 0 THEN
      RAISE EXCEPTION 'No se puede desactivar: % turno(s) futuro(s) vigente(s) y % servicio(s) activo(s) vinculado(s)', v_turnos_fut, v_servicios;
    END IF;
  END IF;

  UPDATE public.puestos SET
    nombre      = v_nombre_final,
    orden       = COALESCE(p_orden, orden),
    observacion = CASE WHEN p_observacion IS NULL THEN observacion
                       ELSE NULLIF(trim(p_observacion), '') END,
    activo      = COALESCE(p_activo, activo),
    updated_at  = now()
  WHERE id = p_id;

  IF v_nombre_final IS DISTINCT FROM v_actual.nombre THEN
    INSERT INTO public.puestos_auditoria
      (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid, 'editar', 'nombre', v_actual.nombre, v_nombre_final);
  END IF;
  IF p_orden IS NOT NULL AND p_orden IS DISTINCT FROM v_actual.orden THEN
    INSERT INTO public.puestos_auditoria
      (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid, 'editar', 'orden', v_actual.orden::text, p_orden::text);
  END IF;
  IF p_observacion IS NOT NULL AND NULLIF(trim(p_observacion), '') IS DISTINCT FROM v_actual.observacion THEN
    INSERT INTO public.puestos_auditoria
      (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid, 'editar', 'observacion', v_actual.observacion, NULLIF(trim(p_observacion), ''));
  END IF;
  IF p_activo IS NOT NULL AND p_activo IS DISTINCT FROM v_actual.activo THEN
    INSERT INTO public.puestos_auditoria
      (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, campo, valor_anterior, valor_nuevo)
    VALUES
      (p_id, v_actual.objetivo_id, v_nombre_final, v_actor, v_uid,
       CASE WHEN p_activo THEN 'activar' ELSE 'desactivar' END, 'activo', v_actual.activo::text, p_activo::text);
  END IF;

  SELECT to_jsonb(p) INTO v_resultado FROM public.puestos p WHERE p.id = p_id;
  RETURN v_resultado;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3) DUPLICAR
-- ----------------------------------------------------------------------------
create or replace function public.duplicar_posicion_operativa(
  p_id_origen uuid,
  p_nombre_nuevo text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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

  -- Gate moderno (reemplaza rol='admin'): actor operativo válido.
  SELECT id INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no activo';
  END IF;
  IF NOT public.es_operador_actual() THEN
    RAISE EXCEPTION 'No autorizado para gestionar posiciones operativas';
  END IF;

  SELECT id, objetivo_id, nombre INTO v_origen FROM public.puestos WHERE id = p_id_origen;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa de origen inexistente';
  END IF;

  -- Alcance derivado del puesto de origen.
  IF NOT public.alcanza_objetivo_actual(v_origen.objetivo_id) THEN
    RAISE EXCEPTION 'El puesto esta fuera de tu alcance';
  END IF;

  v_nombre := trim(p_nombre_nuevo);
  IF v_nombre = '' OR v_nombre IS NULL THEN
    RAISE EXCEPTION 'El nombre de la posicion es obligatorio';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.puestos p
    WHERE p.objetivo_id = v_origen.objetivo_id
      AND p.activo
      AND lower(regexp_replace(trim(p.nombre), '\s+', ' ', 'g')) =
          lower(regexp_replace(v_nombre, '\s+', ' ', 'g'))
  ) THEN
    RAISE EXCEPTION 'Ya existe una posicion operativa activa con ese nombre en este objetivo';
  END IF;

  SELECT COALESCE(MAX(orden), 0) + 1 INTO v_orden
  FROM public.puestos WHERE objetivo_id = v_origen.objetivo_id;

  INSERT INTO public.puestos (objetivo_id, nombre, activo, orden)
  VALUES (v_origen.objetivo_id, v_nombre, true, v_orden)
  RETURNING id INTO v_id;

  INSERT INTO public.puestos_auditoria
    (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, valor_anterior, valor_nuevo, motivo)
  VALUES
    (v_id, v_origen.objetivo_id, v_nombre, v_actor, v_uid, 'duplicar', v_origen.nombre, v_nombre,
     'Duplicado desde posicion ' || v_origen.nombre);

  SELECT to_jsonb(p) INTO v_resultado FROM public.puestos p WHERE p.id = v_id;
  RETURN v_resultado;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4) ELIMINAR (borrado físico con guardas)
-- ----------------------------------------------------------------------------
create or replace function public.eliminar_posicion_operativa(
  p_id uuid,
  p_motivo text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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

  -- Gate moderno (reemplaza rol='admin'): actor operativo válido.
  SELECT id INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no activo';
  END IF;
  IF NOT public.es_operador_actual() THEN
    RAISE EXCEPTION 'No autorizado para gestionar posiciones operativas';
  END IF;

  SELECT id, objetivo_id, nombre INTO v_actual FROM public.puestos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa inexistente';
  END IF;

  -- Alcance derivado del puesto.
  IF NOT public.alcanza_objetivo_actual(v_actual.objetivo_id) THEN
    RAISE EXCEPTION 'El puesto esta fuera de tu alcance';
  END IF;

  SELECT count(*) INTO v_turnos    FROM public.turnos             WHERE puesto_id = p_id;
  SELECT count(*) INTO v_servicios FROM public.servicios_objetivo WHERE puesto_id = p_id;
  SELECT count(*) INTO v_auditoria FROM public.puestos_auditoria  WHERE puesto_id = p_id AND accion <> 'crear';

  IF v_turnos > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: la posicion tiene % turno(s) asociado(s). Usa Desactivar.', v_turnos;
  END IF;
  IF v_servicios > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: la posicion tiene % servicio(s) asociado(s). Usa Desactivar.', v_servicios;
  END IF;
  IF v_auditoria > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: la posicion tiene historial de operaciones. Usa Desactivar.';
  END IF;

  INSERT INTO public.puestos_auditoria
    (puesto_id, objetivo_id, nombre_puesto, usuario_id, auth_user_id, accion, motivo)
  VALUES
    (p_id, v_actual.objetivo_id, v_actual.nombre, v_actor, v_uid, 'eliminar', p_motivo);

  DELETE FROM public.puestos WHERE id = p_id;

  RETURN jsonb_build_object('eliminado', true, 'id', p_id, 'nombre', v_actual.nombre);
END;
$function$;

commit;

notify pgrst, 'reload schema';
