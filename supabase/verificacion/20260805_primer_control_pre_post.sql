-- Verificación PRE/POST — Primer control del vigilador (OT-02 Bloque C)
-- Ejecutar ANTES de aplicar 20260805120000_primer_control_vigilador.sql
-- y de nuevo DESPUÉS.

-- ── PRE ──────────────────────────────────────────────────────────────────────

-- 1. Las tablas no deben existir todavía (esperado: 0 filas).
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('aceptaciones_planilla', 'solicitudes_modificacion_planilla');

-- 2. Estructuras que la migración referencia (esperado: existen las 3).
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('turnos', 'usuarios', 'registros_asistencia');

-- 3. usuarios.auth_user_id existe (la RPC resuelve identidad con auth.uid()).
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'usuarios'
  AND column_name IN ('auth_user_id', 'estado', 'rol');

-- 4. registros_asistencia.cierre_automatico existe (salida automática).
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'registros_asistencia'
  AND column_name = 'cierre_automatico';

-- ── POST ─────────────────────────────────────────────────────────────────────

-- 5. Tablas creadas con RLS habilitada (esperado: 2 filas, rls = true).
SELECT c.relname, c.relrowsecurity AS rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('aceptaciones_planilla', 'solicitudes_modificacion_planilla');

-- 6. Policies de SELECT presentes (esperado: 2 filas).
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('aceptaciones_planilla', 'solicitudes_modificacion_planilla');

-- 7. Índice único de idempotencia y de solicitud pendiente (esperado: ambos).
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('unq_solicitud_mod_planilla_pendiente')
UNION ALL
SELECT conname FROM pg_constraint
WHERE conname = 'aceptaciones_planilla_unq';

-- 8. RPCs creadas (esperado: 2 filas, SECURITY DEFINER).
SELECT p.proname, p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('aceptar_turno_planilla', 'solicitar_modificacion_planilla');

-- 9. Prueba de idempotencia con ROLLBACK (no persiste nada):
--    reemplazar los UUID por un turno real finalizado y su guardia.
-- BEGIN;
--   -- simular sesión del empleado en SQL editor no es posible (auth.uid() nula);
--   -- esta prueba se realiza desde la app autenticada. Ver prueba funcional.
-- ROLLBACK;
