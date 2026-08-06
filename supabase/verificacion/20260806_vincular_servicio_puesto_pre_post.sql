-- Verificación PRE/POST — vincular_servicio_puesto (Bloque E, commit 2)

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. La tabla de auditoría no existe (esperado: 0 filas).
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'servicios_objetivo_auditoria';

-- 2. Estado de vinculación actual (esperado: 7 servicios, 0 con puesto).
SELECT count(*) AS total, count(puesto_id) AS con_puesto FROM public.servicios_objetivo;

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 3. Tabla con RLS y policy (esperado: 1 y 1).
SELECT c.relname, c.relrowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'servicios_objetivo_auditoria';

SELECT policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'servicios_objetivo_auditoria';

-- 4. RPC presente (esperado: 1, secdef=true).
SELECT proname, prosecdef FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'vincular_servicio_puesto';

-- 5. Sin datos modificados por la migración (mismos conteos que el PRE).
SELECT count(*) AS total, count(puesto_id) AS con_puesto FROM public.servicios_objetivo;
