-- ============================================================================
-- VERIFICACIÓN — Etapa 3.3 · B0′: historial de ejecuciones por objetivo
-- ============================================================================
--
-- Acompaña a supabase/migrations/20260730130000_listar_ejecuciones_objetivo.sql
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
select to_regprocedure('public.listar_ejecuciones_objetivo(uuid, date, date)') is not null
       as ya_existe;

-- 1.2 Dependencias que la migración da por existentes. Esperado: todos true.
select
  (to_regclass('public.ronda_ejecuciones')      is not null) as tabla_ejecuciones_ok,
  (to_regclass('public.ronda_ejecucion_puntos') is not null) as tabla_puntos_ok,
  (to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') is not null) as fn_permiso_ok,
  -- Índice que sostiene el filtro (objetivo_id, fecha_operativa).
  (to_regclass('public.idx_ronda_ejecuciones_objetivo_fecha') is not null) as idx_objetivo_fecha_ok;

-- 1.3 Columnas de conteo/cierre que la RPC lee. Esperado: cerrada (3) + fecha_operativa.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='ronda_ejecuciones'
       and column_name in ('cerrada_por','cerrada_at','cerrada_motivo','fecha_operativa')) as cols_ejecuciones,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='ronda_ejecucion_puntos'
       and column_name = 'estado') as col_estado_puntos;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar (estructura y permisos)
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Propiedades. Esperado: security_definer=true, volatility='s',
--     config con search_path=public, pg_catalog, retorna jsonb.
select
  p.prosecdef                   as security_definer,
  p.provolatile                 as volatility,
  p.proconfig                   as config,
  pg_get_function_result(p.oid) as retorna
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'listar_ejecuciones_objetivo';

-- 2.2 Grants. Esperado: anon=false, authenticated=true.
select
  has_function_privilege('anon',          'public.listar_ejecuciones_objetivo(uuid, date, date)', 'execute') as anon_execute,
  has_function_privilege('authenticated', 'public.listar_ejecuciones_objetivo(uuid, date, date)', 'execute') as authenticated_execute;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — PRUEBAS FUNCIONALES (solo lectura, impersonación)
-- ════════════════════════════════════════════════════════════════════════════

-- 3.0 Descubrir material: un objetivo con ejecuciones FINALIZADAS y un supervisor
--     autorizado por zona. Copiá (objetivo_id, supervisor_auth_user_id) y un rango
--     que cubra las fechas_operativas mostradas.
select
  e.objetivo_id,
  o.nombre                       as objetivo,
  min(e.fecha_operativa)         as desde_sugerido,
  max(e.fecha_operativa)         as hasta_sugerido,
  count(*)                       as finalizadas,
  count(*) filter (where e.cerrada_por is not null) as cierres_admin,
  (select u.auth_user_id from public.supervisor_zonas sz
     join public.usuarios u on u.id = sz.supervisor_id
    where sz.zona_id = o.zona_id and u.rol='supervisor'
      and u.auth_user_id is not null and u.estado='activo'
    limit 1)                     as supervisor_auth_user_id
from public.ronda_ejecuciones e
join public.objetivos o on o.id = e.objetivo_id
where e.estado = 'finalizada'
group by e.objetivo_id, o.nombre, o.zona_id
order by finalizadas desc
limit 10;

-- 3.1 CASO OK — supervisor autorizado, rango válido. Esperado: contexto = ok y
--     ejecuciones con conteos cumplidos/incumplidos/omitidos y es_cierre_administrativo.
--     Reemplazá los UUID (SIN corchetes) y las fechas.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"SUPERVISOR_AUTH_USER_ID","role":"authenticated"}';
  select jsonb_pretty(
    public.listar_ejecuciones_objetivo('OBJETIVO_ID', 'YYYY-MM-DD', 'YYYY-MM-DD')
  );
rollback;

-- 3.2 CASO RANGO_INVALIDO — desde > hasta (o null). Esperado: contexto = rango_invalido.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"SUPERVISOR_AUTH_USER_ID","role":"authenticated"}';
  select public.listar_ejecuciones_objetivo('OBJETIVO_ID', '2026-12-31', '2026-01-01');
rollback;

-- 3.3 CASO SIN_PERMISO — supervisor de otra zona (o usuario no vinculado).
--     Esperado: contexto = sin_permiso, ejecuciones = [].
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"SUPERVISOR_DE_OTRA_ZONA_AUTH_USER_ID","role":"authenticated"}';
  select public.listar_ejecuciones_objetivo('OBJETIVO_ID', '2026-01-01', '2026-12-31');
rollback;

-- 3.4 CASO ANON — sin permiso de EXECUTE. Esperado: ERROR permission denied.
begin;
  set local role anon;
  select public.listar_ejecuciones_objetivo('OBJETIVO_ID', '2026-01-01', '2026-12-31');
rollback;

-- 3.5 NO MEZCLA OBJETIVOS — todas las filas deben ser del objetivo pedido.
--     Ejecutá 3.1 con jsonb_array_elements y verificá que no aparezca otro objetivo:
--     (control cruzado, opcional)
--   select count(*) as ejecuciones_ajenas
--   from jsonb_array_elements(
--     (public.listar_ejecuciones_objetivo('OBJETIVO_ID','YYYY-MM-DD','YYYY-MM-DD'))->'ejecuciones'
--   ) x
--   join public.ronda_ejecuciones e on e.id = (x->>'ejecucion_id')::uuid
--   where e.objetivo_id <> 'OBJETIVO_ID';   -- Esperado: 0 (correr como supervisor autorizado)

-- ── Checklist de aceptación del CASO OK (3.1) ──────────────────────────────
--   [ ] contexto = 'ok'
--   [ ] solo ejecuciones con estado = 'finalizada' (ninguna 'en_curso')
--   [ ] cada fila: ronda_nombre, puesto_nombre, guardia_nombre, resultado
--   [ ] puntos_total = cumplidos + incumplidos + omitidos + (pendientes, si los
--       hubiera por cierre admin ya pasados a omitido)
--   [ ] es_cierre_administrativo = true sólo cuando cerrada_por no es null
--   [ ] orden por iniciada_at descendente
--   [ ] fuera del rango [desde,hasta] no aparece nada
