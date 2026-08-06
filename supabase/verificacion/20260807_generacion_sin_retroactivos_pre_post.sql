-- Verificación PRE/POST — generación sin retroactivos (Bloque E)

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. La RPC existe (versión sin bloqueo de fechas pasadas).
SELECT proname, prosecdef FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'crear_turnos_programacion_parcial';

-- 2. Su fuente NO contiene el chequeo 'fecha_pasada'.
SELECT position('fecha_pasada' in pg_get_functiondef(p.oid)) > 0 AS ya_tiene_chequeo
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'crear_turnos_programacion_parcial';

-- 3. Línea base de turnos.
SELECT count(*) AS turnos_total FROM public.turnos;

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 4. RPC sigue SECURITY DEFINER y ahora contiene el chequeo.
SELECT prosecdef,
       position('fecha_pasada' in pg_get_functiondef(p.oid)) > 0 AS tiene_chequeo
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'crear_turnos_programacion_parcial';

-- 5. El reemplazo de la función no creó ni tocó turnos (mismo conteo que PRE).
SELECT count(*) AS turnos_total FROM public.turnos;
