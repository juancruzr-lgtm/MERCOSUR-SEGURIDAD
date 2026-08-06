-- Verificación PRE/POST — crear_turnos_programacion_parcial (Bloque E, commit 4)

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. Columnas de turnos que usa la RPC (guardia_id debe ser nullable).
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'turnos'
  AND column_name IN ('guardia_id','guardia_original_id','estado','tipo_evento',
                      'estado_revision','servicio_base_id','puesto_id');

-- 2. No existe otra RPC equivalente ni la tabla de auditoría.
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname ILIKE '%programacion%';

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'generacion_turnos_auditoria';

-- 3. Conteo de turnos (línea base para el POST).
SELECT count(*) AS turnos_total FROM public.turnos;

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 4. Tabla con RLS y policy (esperado: rls=true, 1 policy).
SELECT c.relrowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'generacion_turnos_auditoria';

SELECT policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'generacion_turnos_auditoria';

-- 5. RPC presente y SECURITY DEFINER (esperado: 1, secdef=true).
SELECT proname, prosecdef FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'crear_turnos_programacion_parcial';

-- 6. La migración no crea turnos por sí sola (mismo conteo que el PRE).
SELECT count(*) AS turnos_total FROM public.turnos;

-- 7. Auditoría vacía hasta la primera operación real.
SELECT count(*) AS operaciones FROM public.generacion_turnos_auditoria;
