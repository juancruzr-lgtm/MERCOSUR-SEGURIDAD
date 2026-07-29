-- ============================================================================
-- VERIFICACIÓN — ronda_id en listar_ejecuciones_en_curso_objetivo
-- ============================================================================
--
-- Acompaña a supabase/migrations/20260730150000_listar_en_curso_ronda_id.sql
--
-- Sección 1: ANTES (la salida no trae ronda_id).
-- Sección 2: DESPUÉS (propiedades/permisos intactos).
-- Sección 3: prueba funcional por impersonación (solo lectura, ROLLBACK).
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 1 — ANTES de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 La función ya existe (viene de 20260729000000). Esperado: true.
select to_regprocedure('public.listar_ejecuciones_en_curso_objetivo(uuid)') is not null as existe;

-- 1.2 Su definición actual NO menciona ronda_id todavía. Esperado: false.
select pg_get_functiondef(
         to_regprocedure('public.listar_ejecuciones_en_curso_objetivo(uuid)')
       ) ilike '%''ronda_id''%' as ya_tiene_ronda_id;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 2 — DESPUÉS de aplicar
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Ahora la definición SÍ incluye ronda_id. Esperado: true.
select pg_get_functiondef(
         to_regprocedure('public.listar_ejecuciones_en_curso_objetivo(uuid)')
       ) ilike '%''ronda_id''%' as ahora_tiene_ronda_id;

-- 2.2 Propiedades intactas. Esperado: security_definer=true, volatility='s'.
select p.prosecdef as security_definer, p.provolatile as volatility, p.proconfig as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'listar_ejecuciones_en_curso_objetivo';

-- 2.3 Grants intactos. Esperado: anon=false, authenticated=true.
select
  has_function_privilege('anon',          'public.listar_ejecuciones_en_curso_objetivo(uuid)', 'execute') as anon_execute,
  has_function_privilege('authenticated', 'public.listar_ejecuciones_en_curso_objetivo(uuid)', 'execute') as authenticated_execute;


-- ════════════════════════════════════════════════════════════════════════════
-- SECCIÓN 3 — PRUEBA FUNCIONAL (impersonación, solo lectura)
-- ════════════════════════════════════════════════════════════════════════════

-- 3.0 Un objetivo con ejecución en curso + un supervisor autorizado.
select
  e.objetivo_id,
  (select u.auth_user_id from public.supervisor_zonas sz
     join public.usuarios u on u.id = sz.supervisor_id
     join public.objetivos o on o.zona_id = sz.zona_id
    where o.id = e.objetivo_id and u.rol='supervisor'
      and u.auth_user_id is not null and u.estado='activo' limit 1) as supervisor_auth_user_id
from public.ronda_ejecuciones e
where e.estado = 'en_curso'
group by e.objetivo_id
limit 5;

-- 3.1 Cada ejecución en curso debe traer ronda_id no nulo. Reemplazá los UUID.
--     Esperado: contexto=ok y todos los elementos con "ronda_id".
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"SUPERVISOR_AUTH_USER_ID","role":"authenticated"}';
  select jsonb_pretty(public.listar_ejecuciones_en_curso_objetivo('OBJETIVO_ID'));
commit;

-- ── Aceptación ──────────────────────────────────────────────────────────────
--   [ ] cada objeto de "ejecuciones" incluye "ronda_id" (uuid, no null)
--   [ ] el resto de campos se conserva igual (id, ronda_nombre, guardia_nombre, …)
