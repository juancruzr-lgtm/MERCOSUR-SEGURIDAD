-- ════════════════════════════════════════════════════════════════════════════
-- Verificación PRE/POST: 20260803210000_anular_registro_manual.sql
-- Anulación lógica y corrección de fecha de registros manuales.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PRE (ejecutar antes de la migración) ────────────────────────────────────

-- 1. Verificar que las columnas NO existen
select column_name from information_schema.columns
 where table_schema = 'public'
   and table_name = 'registros_asistencia'
   and column_name in ('registro_anulado_at', 'registro_anulado_por', 'registro_anulado_motivo');
-- Esperado: 0 filas

-- 2. Verificar que las funciones NO existen
select routine_name from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('anular_registro_manual', 'corregir_fecha_registro_manual');
-- Esperado: 0 filas


-- ── POST (ejecutar después de la migración) ─────────────────────────────────

-- 1. Verificar que las columnas existen
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'registros_asistencia'
   and column_name in ('registro_anulado_at', 'registro_anulado_por', 'registro_anulado_motivo')
 order by column_name;
-- Esperado: 3 filas
--   registro_anulado_at     | timestamp with time zone | YES
--   registro_anulado_motivo | text                     | YES
--   registro_anulado_por    | uuid                     | YES

-- 2. Verificar que las funciones existen
select routine_name, routine_type
  from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('anular_registro_manual', 'corregir_fecha_registro_manual')
 order by routine_name;
-- Esperado: 2 filas (ambas FUNCTION)

-- 3. Verificar que las funciones son SECURITY DEFINER
select proname, prosecdef
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('anular_registro_manual', 'corregir_fecha_registro_manual');
-- Esperado: 2 filas, ambas con prosecdef = true

-- 4. Contar registros manuales existentes (baseline)
select count(*) as registros_manuales,
       count(registro_anulado_at) as ya_anulados
  from public.registros_asistencia
 where tipo_registro = 'carga_manual';
-- Esperado: ya_anulados = 0

-- 5. Verificar que la tabla de auditoría existe (dependencia)
select count(*) from information_schema.tables
 where table_schema = 'public'
   and table_name = 'registros_asistencia_auditoria';
-- Esperado: 1

-- 6. Verificar que turnos_auditoria existe (dependencia de corregir_fecha)
select count(*) from information_schema.tables
 where table_schema = 'public'
   and table_name = 'turnos_auditoria';
-- Esperado: 1
