-- Verificación PRE/POST — Revisión del supervisor (Bloque D)

-- ── PRE ──────────────────────────────────────────────────────────────────────

-- 1. Estructura de alcance existente (esperado: ambas tablas presentes).
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('supervisor_zonas', 'zonas_operativas');

-- 2. objetivos.zona_id existe.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'objetivos' AND column_name = 'zona_id';

-- 3. Supervisores con y sin zonas asignadas (informativo, define el alcance real).
SELECT u.apellido || ', ' || u.nombre AS supervisor,
       count(sz.id) AS zonas_asignadas
FROM public.usuarios u
LEFT JOIN public.supervisor_zonas sz ON sz.supervisor_id = u.id
WHERE u.rol = 'supervisor' AND u.estado = 'activo'
GROUP BY 1 ORDER BY 1;

-- 4. revisiones_planilla no existe todavía (esperado: 0 filas).
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'revisiones_planilla';

-- 5. Estados actuales de solicitudes (esperado: solo 'pendiente' o vacío).
SELECT estado, count(*) FROM public.solicitudes_modificacion_planilla GROUP BY estado;

-- ── POST ─────────────────────────────────────────────────────────────────────

-- 6. Tabla creada con RLS (esperado: 1 fila, rls=true).
SELECT c.relname, c.relrowsecurity FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'revisiones_planilla';

-- 7. Policies con alcance (esperado: 3 policies *_select con
--    turno_en_alcance_supervisor en las de aceptaciones/solicitudes/revisiones).
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('aceptaciones_planilla', 'solicitudes_modificacion_planilla', 'revisiones_planilla');

-- 8. Funciones presentes (esperado: 2, prosecdef=true).
SELECT p.proname, p.prosecdef FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('revisar_primer_control', 'turno_en_alcance_supervisor');
