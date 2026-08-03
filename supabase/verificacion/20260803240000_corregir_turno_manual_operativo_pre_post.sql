-- ════════════════════════════════════════════════════════════════════
-- Verificación PRE/POST — corregir_turno_manual_operativo
-- ════════════════════════════════════════════════════════════════════

-- ── PRE: Ejecutar ANTES de aplicar la migración ────────────────────

-- 1. Verificar que la función NO existe todavía
SELECT NOT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE proname = 'corregir_turno_manual_operativo'
    AND pronamespace = 'public'::regnamespace
) AS "pre_funcion_no_existe";

-- 2. Verificar que la tabla de log NO existe todavía
SELECT NOT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'correccion_turno_manual_log'
) AS "pre_tabla_log_no_existe";

-- 3. Contar registros manuales existentes (referencia)
SELECT COUNT(*) AS "pre_registros_manuales_total"
FROM registros_asistencia
WHERE tipo_registro = 'carga_manual'
  AND registro_anulado_at IS NULL
  AND cobertura_anulada_at IS NULL;


-- ── POST: Ejecutar DESPUÉS de aplicar la migración ─────────────────

-- 1. Verificar que la función existe
SELECT EXISTS (
  SELECT 1 FROM pg_proc
  WHERE proname = 'corregir_turno_manual_operativo'
    AND pronamespace = 'public'::regnamespace
) AS "post_funcion_existe";

-- 2. Verificar que la tabla de log existe
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'correccion_turno_manual_log'
) AS "post_tabla_log_existe";

-- 3. Verificar RLS activo en la tabla de log
SELECT rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'correccion_turno_manual_log';

-- 4. Verificar permisos: anon NO puede ejecutar
SELECT NOT has_function_privilege(
  'anon',
  'corregir_turno_manual_operativo(uuid, uuid, date, time, time, uuid, text)',
  'EXECUTE'
) AS "post_anon_sin_permiso";

-- 5. Verificar permisos: authenticated PUEDE ejecutar
SELECT has_function_privilege(
  'authenticated',
  'corregir_turno_manual_operativo(uuid, uuid, date, time, time, uuid, text)',
  'EXECUTE'
) AS "post_authenticated_con_permiso";

-- 6. Contar registros manuales (debe ser igual al PRE)
SELECT COUNT(*) AS "post_registros_manuales_total"
FROM registros_asistencia
WHERE tipo_registro = 'carga_manual'
  AND registro_anulado_at IS NULL
  AND cobertura_anulada_at IS NULL;
