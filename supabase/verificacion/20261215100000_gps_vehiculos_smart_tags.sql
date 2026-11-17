-- Verificación post-migración 20261215100000_gps_vehiculos_smart_tags (SÓLO LECTURA).

-- 1. Tablas creadas con RLS activa.
select c.relname, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('gps_tags','gps_vehiculos','gps_vehiculo_tag_asignaciones',
  'gps_vehiculo_supervisor_asignaciones','gps_tag_consultas','gps_tag_posiciones','gps_vehiculos_accesos')
order by 1;  -- esperado: 7 filas, rls = true

-- 2. Ninguna política de INSERT/UPDATE/DELETE para usuarios del navegador.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename like 'gps\_%' escape '\' and cmd <> 'SELECT';  -- esperado: 0 filas

-- 3. La ingesta no la puede ejecutar authenticated/anon.
select has_function_privilege('authenticated', 'public.gps_tag_registrar_consulta(uuid, timestamptz, text, jsonb, smallint, integer, text, text)', 'execute') as authenticated_puede,
       has_function_privilege('anon', 'public.gps_tag_registrar_consulta(uuid, timestamptz, text, jsonb, smallint, integer, text, text)', 'execute') as anon_puede;  -- esperado: false, false

-- 4. Ninguna columna con nombre de credencial.
select table_name, column_name from information_schema.columns
where table_schema = 'public' and table_name like 'gps\_%' escape '\'
  and column_name ~* '(token|secret|password|clave|oauth)';  -- esperado: 0 filas

-- 5. El GPS de teléfonos no cambió (debe seguir existiendo, sin columnas nuevas de Smart Tag).
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'supervisor_route_points' and column_name ~* 'tag';  -- esperado: 0 filas

-- 6. Métricas de la prueba de 24 h (reemplazar :tag_id y el rango).
-- with c as (select * from public.gps_tag_consultas where tag_id = :'tag_id' and hora_consulta >= now() - interval '24 hours')
-- select count(*) consultas,
--        count(*) filter (where resultado = 'nueva_posicion') con_nueva,
--        round(100.0 * count(*) filter (where resultado in ('sin_novedad','sin_datos')) / nullif(count(*),0), 1) pct_sin_nueva,
--        count(*) filter (where resultado = 'error') errores
-- from c;
