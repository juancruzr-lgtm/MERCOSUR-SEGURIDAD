-- Verificación PRE/POST — servicios_objetivo.puesto_id (Bloque E, commit 1)

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. La columna no existe (esperado: 0 filas).
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'servicios_objetivo'
  AND column_name = 'puesto_id';

-- 2. Servicios y su nombre_puesto legacy (informativo).
SELECT count(*) AS total,
       count(*) FILTER (WHERE COALESCE(btrim(nombre_puesto), '') <> '') AS con_texto
FROM public.servicios_objetivo;

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 3. Columna presente con FK (esperado: 1 fila).
SELECT c.column_name, c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'servicios_objetivo'
  AND c.column_name = 'puesto_id';

-- 4. Trigger de integridad presente (esperado: 1 fila).
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.servicios_objetivo'::regclass
  AND tgname = 'trg_validar_puesto_servicio';

-- 5. Ningún dato modificado (esperado: mismas cantidades que el PRE,
--    y puesto_id NULL en todas las filas).
SELECT count(*) AS total, count(puesto_id) AS con_puesto
FROM public.servicios_objetivo;
