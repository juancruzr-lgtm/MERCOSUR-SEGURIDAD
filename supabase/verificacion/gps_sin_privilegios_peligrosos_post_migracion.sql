-- Verificación posterior a aplicar 20261102120000 (GPS sin privilegios peligrosos).
-- Una sola consulta de lectura. Si alguna fila da ok = false, NO desplegar.

with
t as (select 'public.supervisor_route_points'::regclass as r),
c1 as (select string_agg(privilege_type, ',' order by privilege_type) v from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'supervisor_route_points' and grantee = 'authenticated'),
c2 as (select count(*) n from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'supervisor_route_points' and grantee = 'anon'),
c3 as (select (has_table_privilege('authenticated', (select r from t), 'TRUNCATE')
            or has_table_privilege('authenticated', (select r from t), 'UPDATE')
            or has_table_privilege('authenticated', (select r from t), 'DELETE'))::int n),
c4 as (select (has_table_privilege('authenticated', (select r from t), 'INSERT')
           and has_table_privilege('authenticated', (select r from t), 'SELECT'))::int n),
c5 as (select string_agg(policyname, ' | ' order by policyname) v from pg_policies
       where schemaname = 'public' and tablename = 'supervisor_route_points'),
c6 as (select count(*) n from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'supervisor_route_points' and grantee = 'service_role'),
c7 as (select relrowsecurity::int n from pg_class where oid = (select r from t))
select 1 o, 'authenticated: sólo INSERT y SELECT' control, 'INSERT,SELECT' esperado, v obtenido, v = 'INSERT,SELECT' ok from c1
union all select 2, 'anon sin privilegios', '0', n::text, n = 0 from c2
union all select 3, 'authenticated sin TRUNCATE/UPDATE/DELETE', '0', n::text, n = 0 from c3
union all select 4, 'authenticated conserva INSERT y SELECT', '1', n::text, n = 1 from c4
union all select 5, 'Políticas sin cambios (las 3 de siempre)',
  'Admin lee todos los recorridos | Supervisor inserta sus propios puntos GPS | Supervisor lee sus propios recorridos', v,
  v = 'Admin lee todos los recorridos | Supervisor inserta sus propios puntos GPS | Supervisor lee sus propios recorridos' from c5
union all select 6, 'service_role sin cambios (7 privilegios)', '7', n::text, n = 7 from c6
union all select 7, 'RLS sigue activa', '1', n::text, n = 1 from c7
order by 1;
