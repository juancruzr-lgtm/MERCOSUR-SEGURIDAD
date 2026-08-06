-- Verificación PRE/POST — gestión de posiciones operativas (Bloque E)

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. Columna observacion todavía no existe; RPCs todavía no existen.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'puestos' AND column_name = 'observacion';

SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN
  ('crear_posicion_operativa', 'editar_posicion_operativa', 'duplicar_posicion_operativa', 'eliminar_posicion_operativa');

-- 2. Línea base: cantidad de posiciones y de servicios (no debe cambiar con la migración).
SELECT count(*) AS puestos_total FROM public.puestos;
SELECT count(*) AS servicios_total FROM public.servicios_objetivo;

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 3. Columna agregada.
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'puestos' AND column_name = 'observacion';

-- 4. Tabla de auditoría con RLS y policy.
SELECT relrowsecurity FROM pg_class WHERE relname = 'puestos_auditoria';
SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'puestos_auditoria';

-- 5. Las 4 RPCs presentes y SECURITY DEFINER.
SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN
  ('crear_posicion_operativa', 'editar_posicion_operativa', 'duplicar_posicion_operativa', 'eliminar_posicion_operativa');

-- 6. La migración no tocó datos existentes (mismos conteos que el PRE).
SELECT count(*) AS puestos_total FROM public.puestos;
SELECT count(*) AS servicios_total FROM public.servicios_objetivo;

-- 7. Auditoría vacía hasta la primera operación real.
SELECT count(*) AS operaciones FROM public.puestos_auditoria;
