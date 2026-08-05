-- Verificación PRE/POST — Característica del turno (OT-01 Bloque B)
-- Ejecutar ANTES de aplicar 20260805100000_turnos_caracteristica.sql
-- y de nuevo DESPUÉS para confirmar el resultado.

-- ── PRE ──────────────────────────────────────────────────────────────────────

-- 1. Valores actuales de tipo_evento y su volumen.
--    Esperado: solo 'normal', 'cobertura' y/o NULL.
--    Si aparece cualquier otro valor, NO aplicar la migración y reportar.
SELECT tipo_evento, count(*) AS cantidad
FROM public.turnos
GROUP BY tipo_evento
ORDER BY cantidad DESC;

-- 2. Turnos con tipo_evento NULL (serán normalizados a 'normal').
SELECT count(*) AS turnos_null
FROM public.turnos
WHERE tipo_evento IS NULL;

-- 3. Constraint existente (esperado: 0 filas antes de migrar).
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.turnos'::regclass
  AND conname = 'turnos_tipo_evento_check';

-- ── POST ─────────────────────────────────────────────────────────────────────

-- 4. Después de migrar: no debe quedar ningún NULL ni valor fuera de la lista.
SELECT count(*) AS fuera_de_lista
FROM public.turnos
WHERE tipo_evento IS NULL
   OR tipo_evento NOT IN ('normal', 'cobertura', 'capacitacion');

-- 5. Constraint presente (esperado: 1 fila).
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.turnos'::regclass
  AND conname = 'turnos_tipo_evento_check';

-- 6. Default y NOT NULL de la columna.
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'turnos' AND column_name = 'tipo_evento';
