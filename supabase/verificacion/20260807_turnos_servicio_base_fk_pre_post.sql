-- Verificación PRE/POST — FK de turnos.servicio_base_id (Bloque E)

-- ── PRE ──────────────────────────────────────────────────────────────────────
-- 1. FK actual (esperado: REFERENCES servicios_base(id)).
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'turnos_servicio_base_id_fkey';

-- 2. Nadie usa la columna todavía (esperado: 0) y servicios_base está vacía.
SELECT
  (SELECT count(*) FROM public.turnos WHERE servicio_base_id IS NOT NULL) AS turnos_con_sbid,
  (SELECT count(*) FROM public.servicios_base) AS filas_servicios_base;

-- ── POST ─────────────────────────────────────────────────────────────────────
-- 3. FK re-apuntada (esperado: REFERENCES servicios_objetivo(id) ON DELETE SET NULL).
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'turnos_servicio_base_id_fkey';

-- 4. El cambio de constraint no tocó datos (mismos conteos que el PRE).
SELECT count(*) AS turnos_total FROM public.turnos;
