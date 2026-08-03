-- ════════════════════════════════════════════════════════════════════════════
-- Verificación PRE/POST: 20260803200000_cuil_usuarios.sql
-- Agrega campo CUIL a la tabla usuarios.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PRE (ejecutar antes de la migración) ────────────────────────────────────

-- 1. Verificar que la columna NO existe aún
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'usuarios'
   and column_name = 'cuil';
-- Esperado: 0 filas

-- 2. Verificar que el índice NO existe
select indexname from pg_indexes
 where schemaname = 'public'
   and tablename = 'usuarios'
   and indexname = 'usuarios_cuil_unique';
-- Esperado: 0 filas


-- ── POST (ejecutar después de la migración) ─────────────────────────────────

-- 1. Verificar que la columna existe
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'usuarios'
   and column_name = 'cuil';
-- Esperado: 1 fila → cuil | text | YES

-- 2. Verificar que el índice único parcial existe
select indexname, indexdef from pg_indexes
 where schemaname = 'public'
   and tablename = 'usuarios'
   and indexname = 'usuarios_cuil_unique';
-- Esperado: 1 fila con WHERE cuil IS NOT NULL

-- 3. Verificar que los usuarios existentes tienen cuil = null (no se rompe nada)
select count(*) as total_usuarios,
       count(cuil) as con_cuil
  from public.usuarios;
-- Esperado: con_cuil = 0 (recién creado, sin datos cargados)

-- 4. Prueba funcional: insertar un CUIL y verificar unicidad
-- (solo en entorno de prueba)
-- update public.usuarios set cuil = '20-12345678-9' where id = '<test-id>';
-- select cuil from public.usuarios where cuil is not null;
