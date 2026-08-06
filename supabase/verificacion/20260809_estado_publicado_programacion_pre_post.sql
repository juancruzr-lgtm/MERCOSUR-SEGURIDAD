-- Verificación PRE/POST — Estado Publicado para la programación mensual

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. Columnas y RPC todavía no existen.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'turnos' AND column_name IN ('publicado', 'publicado_at', 'publicado_por');

SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'publicar_turnos_programacion';

-- 2. Línea base: ningún turno publicado, cantidad total de turnos sin cambiar.
SELECT count(*) AS turnos_total FROM public.turnos;
SELECT count(*) FILTER (WHERE estado = 'reemplazado') AS turnos_reemplazados FROM public.turnos;

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 3. Columnas agregadas.
SELECT column_name, is_nullable, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'turnos' AND column_name IN ('publicado', 'publicado_at', 'publicado_por');

-- 4. Tabla de auditoría con RLS y policy.
SELECT relrowsecurity FROM pg_class WHERE relname = 'programacion_publicaciones';
SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'programacion_publicaciones';

-- 5. RPC presente y SECURITY DEFINER.
SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'publicar_turnos_programacion';

-- 6. La migración no tocó datos existentes (mismo total, cero publicados).
SELECT count(*) AS turnos_total FROM public.turnos;
SELECT count(*) AS turnos_publicados FROM public.turnos WHERE publicado = true;

-- 7. Auditoría vacía hasta la primera publicación real.
SELECT count(*) AS operaciones FROM public.programacion_publicaciones;
