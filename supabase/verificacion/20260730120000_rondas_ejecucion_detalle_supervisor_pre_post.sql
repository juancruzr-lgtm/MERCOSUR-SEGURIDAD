-- ============================================================================
-- VERIFICACIÓN — Etapa 3.3 · B1: detalle de ejecución para supervisor
-- ============================================================================
--
-- Acompaña a supabase/migrations/20260730120000_rondas_ejecucion_detalle_supervisor.sql
--
-- Sección 1: solo lectura, ANTES de aplicar.
-- Sección 2: estructura y permisos, DESPUÉS de aplicar.
-- Sección 3: pruebas funcionales por impersonación (SOLO lectura). La RPC es
--            `stable` y no escribe: cada prueba corre en una transacción que
--            termina en ROLLBACK y no deja ningún dato.
--
-- La RPC usa auth.uid(); una ejecución directa como postgres (auth.uid() NULL)
-- no es una prueba válida. Se impersona con `set local request.jwt.claims`.
-- No se muestran tokens ni secretos: se usa el UUID de auth.users, no un JWT.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — ANTES de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 La función no debe existir todavía. Esperado: false.
select to_regprocedure('public.rondas_ejecucion_detalle_supervisor(uuid)') is not null
       as ya_existe;

-- 1.2 Dependencias que la migración da por existentes. Esperado: todos true.
select
  (to_regclass('public.ronda_ejecuciones')      is not null) as tabla_ejecuciones_ok,
  (to_regclass('public.ronda_ejecucion_puntos') is not null) as tabla_puntos_ok,
  (to_regclass('public.evidencias')             is not null) as tabla_evidencias_ok,
  (to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') is not null) as fn_permiso_ok;

-- 1.3 Columnas que la RPC lee. Esperado: 10.
select count(*) as columnas_requeridas
  from information_schema.columns
 where table_schema = 'public'
   and (
     (table_name = 'ronda_ejecuciones'
        and column_name in ('cerrada_por', 'cerrada_at', 'cerrada_motivo'))
     or
     (table_name = 'ronda_ejecucion_puntos'
        and column_name in ('hay_novedad', 'snap_politica_foto', 'distancia_metros',
                            'gps_ok', 'dentro_radio', 'foto_ok', 'comentario'))
   );


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar (estructura y permisos)
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Propiedades. Esperado: security_definer=true, volatility='s',
--     config contiene search_path=public, pg_catalog, retorna jsonb.
select
  p.prosecdef                       as security_definer,
  p.provolatile                     as volatility,
  p.proconfig                       as config,
  pg_get_function_result(p.oid)     as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'rondas_ejecucion_detalle_supervisor';

-- 2.2 Grants. Esperado: anon=false, authenticated=true.
select
  has_function_privilege('anon',          'public.rondas_ejecucion_detalle_supervisor(uuid)', 'execute') as anon_execute,
  has_function_privilege('authenticated', 'public.rondas_ejecucion_detalle_supervisor(uuid)', 'execute') as authenticated_execute;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — PRUEBAS FUNCIONALES (solo lectura, impersonación)
-- ════════════════════════════════════════════════════════════════════════════

-- 3.0 Descubrir material de prueba: una ejecución y un supervisor autorizado
--     para su objetivo (por zona). Copiá un par (ejecucion_id, auth_user_id).
select
  e.id                          as ejecucion_id,
  e.estado,
  o.nombre                      as objetivo,
  u.auth_user_id                as supervisor_auth_user_id,
  u.apellido || ', ' || u.nombre as supervisor
from public.ronda_ejecuciones e
join public.objetivos      o  on o.id = e.objetivo_id
join public.supervisor_zonas sz on sz.zona_id = o.zona_id
join public.usuarios       u  on u.id = sz.supervisor_id
where u.rol = 'supervisor' and u.auth_user_id is not null and u.estado = 'activo'
order by e.iniciada_at desc
limit 10;

-- 3.1 CASO OK — supervisor autorizado. Esperado: contexto = ok, y el JSON trae
--     ejecucion (guardia/puesto/ronda/estado/resultado/tiempos/cerrada_*) y
--     puntos con GPS real, veredictos, comentario/hay_novedad y evidencias.
--     Reemplazá los dos UUID (SIN corchetes).
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"SUPERVISOR_AUTH_USER_ID","role":"authenticated"}';
  select jsonb_pretty(
    public.rondas_ejecucion_detalle_supervisor('EJECUCION_ID')
  );
rollback;

-- 3.2 CASO SIN_PERMISO — supervisor de otra zona (o usuario no vinculado a
--     usuarios). Esperado: contexto = sin_permiso (no expone datos).
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"SUPERVISOR_DE_OTRA_ZONA_AUTH_USER_ID","role":"authenticated"}';
  select public.rondas_ejecucion_detalle_supervisor('EJECUCION_ID');
rollback;

-- 3.3 CASO NO_ENCONTRADA — id inexistente, con un supervisor válido.
--     Esperado: contexto = no_encontrada.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"SUPERVISOR_AUTH_USER_ID","role":"authenticated"}';
  select public.rondas_ejecucion_detalle_supervisor('00000000-0000-0000-0000-000000000000');
rollback;

-- 3.4 CASO ANON — sin permiso de EXECUTE. Esperado: ERROR permission denied.
begin;
  set local role anon;
  select public.rondas_ejecucion_detalle_supervisor('00000000-0000-0000-0000-000000000000');
rollback;

-- ── Checklist de aceptación del CASO OK (3.1) ──────────────────────────────
--   [ ] contexto = 'ok'
--   [ ] ejecucion.guardia_nombre, puesto_nombre, ronda_nombre presentes
--   [ ] ejecucion.estado / resultado / iniciada_at / finalizada_at correctos
--   [ ] ejecucion.es_cierre_administrativo refleja cerrada_por (true si admin)
--   [ ] cada punto trae latitud/longitud reales, distancia_metros, gps_ok,
--       dentro_radio, foto_ok, comentario, hay_novedad
--   [ ] puntos ordenados por 'orden'
--   [ ] evidencias con bucket='ronda-evidencias' y storage_path (sin URL firmada)
