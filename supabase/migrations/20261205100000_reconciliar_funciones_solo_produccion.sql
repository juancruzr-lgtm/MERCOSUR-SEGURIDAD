/*
================================================================================
Reconciliación repo ↔ producción: funciones que existían SÓLO en producción
================================================================================

QUÉ ES
  Una migración "foto". Copia al repo, byte a byte, la definición VIVA de
  producción (leída el 04/11/2026 con pg_get_functiondef) de funciones que
  corren en producción y que ningún archivo de supabase/migrations describía:

    crear_puesto_principal_por_defecto()  trigger AFTER INSERT en objetivos
                                          (trg_crear_puesto_principal_objetivo)
    current_user_role()                   lo usan is_admin / is_supervisor_or_admin
    current_usuario_id()
    ia_es_admin()                         políticas de ia_lotes, entrenamiento_operativo,
                                          evaluaciones_mensuales, intervenciones_uso_app,
                                          observaciones_evaluacion; entrenamiento_en_alcance()
    ia_es_operador()                      políticas de ia_configuraciones, ia_referencia_imagenes
    repdoc_upsert_atomico(...)            agente documental (agente-documental/src/repository)
    set_actualizado_at()                  trigger trg_repdoc_actualizado_at
    update_updated_at()                   trigger turnos_updated_at (BEFORE UPDATE en turnos)
    turnos_completar_puesto()             trigger trg_turnos_completar_puesto (ver abajo)

  `repdoc_upsert_atomico` y `set_actualizado_at` tenían una copia vieja en
  agente-documental/supabase/migrations/, que no forma parte de la cadena de
  migraciones de la aplicación. `rondas_resultado_ejecucion(uuid)` figuraba en
  la auditoría como "sólo en producción", pero ya está en
  20261120120000_rondas_regla_validacion_aprobada.sql con el mismo texto
  (mismo md5 de prosrc): NO se repite acá; la verificación posterior igual la
  controla.

AL APLICARSE SOBRE PRODUCCIÓN NO CAMBIA NADA
  * `create or replace` con el mismo cuerpo, el mismo SECURITY DEFINER / INVOKER,
    la misma volatilidad y el mismo `SET search_path` (proconfig) que hay vivos.
    El search_path NO se corrige acá: lo hace 20261205120000 (otra fase).
  * `create or replace` conserva dueño y permisos (proacl): esta migración NO
    toca grants. Los permisos vivos al 04/11 quedan documentados junto a cada
    función.
  * Los cuerpos vivos tienen fin de línea CRLF (se cargaron desde Windows).
    Para que el md5 de prosrc coincida sin depender de cómo git haga el
    checkout (core.autocrlf), cada definición se ejecuta normalizando primero
    a LF y después a CRLF.
  * Triggers: se crean sólo si faltan (en producción ya existen; no se recrean).
  * repdoc_upsert_atomico sólo se crea si existe public.repositorio_documental
    (su %ROWTYPE lo exige).
  * Al final se compara el md5 de prosrc de cada función con el de producción;
    si alguno no coincide la migración aborta entera.

POR QUÉ LA VERSIÓN DEL REPO DE turnos_completar_puesto ERA INCORRECTA
  20260728100000_turnos_completar_puesto.sql hace `min(p.id)` sobre una
  columna uuid. PostgreSQL (producción corre 17.6) no tiene agregado
  min(uuid): la función se crea sin error (plpgsql no resuelve la consulta al
  crearla), pero el primer INSERT en turnos sin puesto_id falla con
  "function min(uuid) does not exist". Por eso en producción se corrigió a mano
  a `min(p.id::text)::uuid`, y de paso se quitó el guard
  `if new.objetivo_id is null then return new` (sin objetivo, el conteo da 0 y
  el puesto queda null igual: el resultado es el mismo). Si alguien reaplicara
  la migración del repo, se romperían todas las altas de turnos sin puesto
  (generación mensual, alta individual, carga del supervisor). Desde esta
  migración el repo describe la versión viva y corregida.

ROLLBACK
  supabase/rollback/20261205100000_reconciliar_funciones_solo_produccion_rollback.sql
  (no-op documentado: esta migración no cambia producción).
VERIFICACIÓN
  supabase/pruebas/reconciliacion/verificacion-reconciliacion.sql
================================================================================
*/

begin;

-- ── crear_puesto_principal_por_defecto ──────────────────────────────────────
-- proacl vivo: {=X, postgres=X, authenticated=X, service_role=X}
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.crear_puesto_principal_por_defecto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  -- Protección adicional para evitar duplicados
  if not exists (
    select 1
    from public.puestos p
    where p.objetivo_id = new.id
      and p.activo = true
  ) then
    insert into public.puestos (
      objetivo_id,
      nombre,
      activo,
      orden
    )
    values (
      new.id,
      'Principal',
      true,
      1
    );
  end if;

  return new;
end;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

-- ── current_user_role ───────────────────────────────────────────────────────
-- proacl vivo: {=X, postgres=X, anon=X, authenticated=X, service_role=X}
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select rol
  from public.usuarios
  where auth_user_id = auth.uid()
  limit 1;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

-- ── current_usuario_id ──────────────────────────────────────────────────────
-- proacl vivo: {=X, postgres=X, anon=X, authenticated=X, service_role=X}
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.current_usuario_id()
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id
  from public.usuarios
  where auth_user_id = auth.uid()
  limit 1;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

-- ── ia_es_admin ─────────────────────────────────────────────────────────────
-- proacl vivo: {postgres=X, authenticated=X, service_role=X}
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.ia_es_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and u.rol = 'admin'
  )
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

comment on function public.ia_es_admin() is
  'true si el usuario autenticado es admin activo. Uso: policies de configuración IA.';

-- ── ia_es_operador ──────────────────────────────────────────────────────────
-- proacl vivo: {postgres=X, authenticated=X, service_role=X}
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.ia_es_operador()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and u.rol in ('admin', 'supervisor')
  )
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

comment on function public.ia_es_operador() is
  'true si el usuario autenticado es admin o supervisor activo. El supervisor necesita LEER los criterios para poder juzgar una foto, aunque no pueda editarlos.';

-- ── set_actualizado_at ──────────────────────────────────────────────────────
-- proacl vivo: {=X, postgres=X, anon=X, authenticated=X, service_role=X}
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.set_actualizado_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.actualizado_at := now();
  return new;
end;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

-- ── update_updated_at ───────────────────────────────────────────────────────
-- proacl vivo: {=X, postgres=X, anon=X, authenticated=X, service_role=X}
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

-- ── turnos_completar_puesto (arreglo vivo: min(p.id::text)::uuid) ───────────
-- proacl vivo: {=X, postgres=X, authenticated=X, service_role=X}
-- El trigger trg_turnos_completar_puesto (BEFORE INSERT en turnos) ya lo crea
-- 20260728100000; no se toca.
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.turnos_completar_puesto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_activos integer;
  v_puesto_id uuid;
begin
  if new.puesto_id is not null then
    return new;
  end if;

  select
    count(*),
    min(p.id::text)::uuid
  into
    v_activos,
    v_puesto_id
  from public.puestos p
  where p.objetivo_id = new.objetivo_id
    and p.activo;

  -- Solo asigna cuando no hay ambigüedad. Con 0 o 2+ puestos activos
  -- deja el null y la validación queda en la aplicación.
  if v_activos = 1 then
    new.puesto_id := v_puesto_id;
  end if;

  return new;
end;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

-- ── repdoc_upsert_atomico (sólo si existe repositorio_documental) ───────────
-- proacl vivo: {=X, postgres=X, anon=X, authenticated=X, service_role=X}
-- SECURITY INVOKER, sin search_path propio (igual que en producción).
do $do$
begin
  if to_regclass('public.repositorio_documental') is null then
    raise notice 'repositorio_documental no existe: se omite repdoc_upsert_atomico';
    return;
  end if;
  execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.repdoc_upsert_atomico(p_documento_uid uuid, p_agente_id text, p_ruta_relativa text, p_hash_sha256 text, p_nombre_archivo text, p_extension text, p_mime_type text, p_tamano_bytes bigint, p_fecha_creacion_archivo timestamp with time zone, p_fecha_modificacion_archivo timestamp with time zone, p_origen text, p_empresa text)
 RETURNS TABLE(out_version_actual integer, out_hash_sha256 text, out_fue_nuevo boolean, out_hash_cambio boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing    repositorio_documental%ROWTYPE;
  v_fue_nuevo   boolean := false;
  v_hash_cambio boolean := false;
BEGIN
  -- Intento de inserción.
  -- Si dos procesos llegan simultáneamente para un documento nuevo,
  -- uno insertará exitosamente y el otro recibirá FOUND = false
  -- (ON CONFLICT DO NOTHING suprime el insert sin error), cayendo al bloque UPDATE.
  INSERT INTO repositorio_documental (
    documento_uid,
    version_actual,
    agente_id,
    origen,
    empresa,
    tipo_documento,
    nombre_archivo,
    extension,
    mime_type,
    ruta_relativa,
    tamano_bytes,
    hash_sha256,
    fecha_creacion_archivo,
    fecha_modificacion_archivo,
    detectado_por_primera_vez_at,
    detectado_por_ultima_vez_at,
    disponible,
    estado_indexacion,
    categoria,
    etiquetas,
    ultimo_error
  ) VALUES (
    p_documento_uid,
    1,
    p_agente_id,
    p_origen,
    p_empresa,
    NULL,
    p_nombre_archivo,
    p_extension,
    p_mime_type,
    p_ruta_relativa,
    p_tamano_bytes,
    p_hash_sha256,
    p_fecha_creacion_archivo,
    p_fecha_modificacion_archivo,
    now(),
    now(),
    true,
    'indexado',
    NULL,
    '{}',
    NULL
  )
  ON CONFLICT (agente_id, ruta_relativa) DO NOTHING;

  IF FOUND THEN
    -- INSERT tuvo efecto: documento genuinamente nuevo.
    v_fue_nuevo   := true;
    v_hash_cambio := true;
  ELSE
    -- El registro ya existía (o fue insertado por otro proceso simultáneo).
    -- SELECT FOR UPDATE adquiere el lock de fila, bloqueando a cualquier otro
    -- proceso que intente modificar este mismo (agente_id, ruta_relativa).
    -- Cuando el lock se libera (al hacer COMMIT), el siguiente proceso lee
    -- el valor actualizado — nunca el valor stale previo a la operación anterior.
    SELECT * INTO v_existing
    FROM repositorio_documental
    WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa
    FOR UPDATE;

    IF v_existing.hash_sha256 <> p_hash_sha256 THEN
      -- El hash almacenado en este momento difiere del recibido: cambio real.
      -- version_actual + 1 opera sobre el valor en la base, no sobre un
      -- valor calculado previamente en Node.
      UPDATE repositorio_documental SET
        version_actual              = v_existing.version_actual + 1,
        hash_sha256                 = p_hash_sha256,
        nombre_archivo              = p_nombre_archivo,
        tamano_bytes                = p_tamano_bytes,
        fecha_creacion_archivo      = p_fecha_creacion_archivo,
        fecha_modificacion_archivo  = p_fecha_modificacion_archivo,
        detectado_por_ultima_vez_at = now(),
        disponible                  = true,
        estado_indexacion           = 'indexado',
        ultimo_error                = NULL
      WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa;
      v_hash_cambio := true;

    ELSE
      -- Mismo hash que el almacenado actualmente: no hay cambio documental.
      -- Cubre tanto el caso normal (sin cambio) como reaparición con mismo hash
      -- (disponible false → true, sin incremento artificial de versión).
      UPDATE repositorio_documental SET
        detectado_por_ultima_vez_at = now(),
        tamano_bytes                = p_tamano_bytes,
        fecha_modificacion_archivo  = p_fecha_modificacion_archivo,
        disponible                  = true,
        estado_indexacion           = 'indexado',
        ultimo_error                = NULL
      WHERE agente_id = p_agente_id AND ruta_relativa = p_ruta_relativa;
      v_hash_cambio := false;
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      rd.version_actual,
      rd.hash_sha256::text,
      v_fue_nuevo,
      v_hash_cambio
    FROM repositorio_documental rd
    WHERE rd.agente_id = p_agente_id AND rd.ruta_relativa = p_ruta_relativa;
END;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n');
end $do$;

-- ── Triggers vivos que usan estas funciones (sólo si faltan) ────────────────
do $do$
begin
  if to_regclass('public.objetivos') is not null and not exists (
    select 1 from pg_trigger
     where tgrelid = to_regclass('public.objetivos')
       and tgname = 'trg_crear_puesto_principal_objetivo'
  ) then
    create trigger trg_crear_puesto_principal_objetivo
      after insert on public.objetivos
      for each row execute function public.crear_puesto_principal_por_defecto();
  end if;

  if to_regclass('public.turnos') is not null and not exists (
    select 1 from pg_trigger
     where tgrelid = to_regclass('public.turnos')
       and tgname = 'turnos_updated_at'
  ) then
    create trigger turnos_updated_at
      before update on public.turnos
      for each row execute function public.update_updated_at();
  end if;

  if to_regclass('public.repositorio_documental') is not null and not exists (
    select 1 from pg_trigger
     where tgrelid = to_regclass('public.repositorio_documental')
       and tgname = 'trg_repdoc_actualizado_at'
  ) then
    create trigger trg_repdoc_actualizado_at
      before update on public.repositorio_documental
      for each row execute function public.set_actualizado_at();
  end if;
end $do$;

-- ── Control: el md5 de prosrc tiene que ser el de producción (04/11/2026) ───
do $do$
declare
  v_esperado constant jsonb := jsonb_build_object(
    'crear_puesto_principal_por_defecto()', '82287ea341aed3a01f825b319a0fbd80',
    'current_user_role()',                  'c8f95381f6a08e42017f78f11e864773',
    'current_usuario_id()',                 'a3114d44c301d1106af8cc93ee597838',
    'ia_es_admin()',                        'cdfa6875320ac49171921860b6757e64',
    'ia_es_operador()',                     'c56c30ab3425335f21fca7bc29afdf3c',
    'set_actualizado_at()',                 '439b7b3853471a4ced179a4cc5283af0',
    'update_updated_at()',                  '749d6e72e457701152e365704cde3807',
    'turnos_completar_puesto()',            '8318c7ff6ee03dc9120bb583c7881942',
    'repdoc_upsert_atomico(uuid,text,text,text,text,text,text,bigint,timestamp with time zone,timestamp with time zone,text,text)',
                                            '8649a58882527c5b9860ef5752fb9953');
  v_firma text;
  v_md5   text;
begin
  for v_firma in select jsonb_object_keys(v_esperado) loop
    v_md5 := (select md5(p.prosrc) from pg_proc p
               where p.oid = to_regprocedure('public.' || v_firma));
    if v_md5 is null and v_firma like 'repdoc_upsert_atomico(%'
       and to_regclass('public.repositorio_documental') is null then
      continue;
    end if;
    if v_md5 is distinct from v_esperado->>v_firma then
      raise exception 'reconciliación: % quedó con md5 % (producción: %)',
        v_firma, coalesce(v_md5, 'inexistente'), v_esperado->>v_firma;
    end if;
  end loop;
end $do$;

commit;
