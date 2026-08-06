-- Verificación PRE/POST — asignar_vigilador_turnos (Bloque E)

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. No existe otra RPC de asignación equivalente.
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname ILIKE '%asignar%';

-- 2. supervisor_zonas tiene las columnas esperadas.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'supervisor_zonas';

-- 3. Línea base de NSER (esperado: 72 vigentes, 72 sin guardia).
SELECT count(*) AS total, count(*) FILTER (WHERE guardia_id IS NULL) AS sin_guardia
FROM public.turnos
WHERE objetivo_id = '790807dd-8283-4e6e-90bc-832226d016df'
  AND fecha BETWEEN '2026-08-07' AND '2026-08-31'
  AND estado NOT IN ('reemplazado');

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 4. RPC creada, SECURITY DEFINER.
SELECT proname, prosecdef FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'asignar_vigilador_turnos';

-- 5. Grants solo a authenticated.
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
WHERE routine_schema = 'public' AND routine_name = 'asignar_vigilador_turnos';

-- 6. La migración por sí sola no tocó turnos (mismo conteo que el PRE).
SELECT count(*) AS total, count(*) FILTER (WHERE guardia_id IS NULL) AS sin_guardia
FROM public.turnos
WHERE objetivo_id = '790807dd-8283-4e6e-90bc-832226d016df'
  AND fecha BETWEEN '2026-08-07' AND '2026-08-31'
  AND estado NOT IN ('reemplazado');
