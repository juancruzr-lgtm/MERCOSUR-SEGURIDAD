-- Verificación posterior a aplicar 20261030120000 (legajo operativo de supervisores).
-- Una sola consulta de lectura (el editor muestra sólo el último resultado).
-- Si alguna fila da ok = false, NO desplegar.

with
autorizados_esperados(id) as (values
  ('3a8e3c04-f4f5-48c4-8830-73edccb73667'::uuid),  -- Juan Cruz Romero (Gerencia)
  ('5a8e3f70-77ef-4f89-8332-b9878f32a293'::uuid),  -- Facundo Romero (Gerencia)
  ('3731aa27-ce78-4817-8faa-66ad1edfabaa'::uuid),  -- Rodolfo Romero (Dirección Operativa)
  ('023769de-9e99-481a-9caa-c604ef56b14b'::uuid),  -- Aldo Monzón (Jefe de supervisores)
  ('1384746c-0520-4ebe-8d7b-17788d833cba'::uuid),  -- Laura M. (Administración)
  ('a2cd1908-7e9d-4bf4-8407-ecf644e1f351'::uuid),  -- Joel Juárez (Administración)
  ('eecd4b5c-095d-4062-be10-25e78ea9f499'::uuid)   -- Andrea Narvarte (Administración)
),
pasan as (select u.id from public.usuarios u where u.estado = 'activo' and public.puede_ver_legajo_supervisores(u.id)),
c1 as (select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.prosecdef and p.proname in (
         'puede_ver_legajo_supervisores', 'puede_ver_legajo_supervisores_actual', 'legajo_supervisores_guardias',
         'legajo_supervisores_supervisiones', 'legajo_supervisor_recorrido')),
c2 as (select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname like any (array['puede_ver_legajo_supervisores%', 'legajo_supervisor%'])
         and has_function_privilege('anon', p.oid, 'execute')),
c3 as (select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'puede_ver_legajo_supervisores'
         and has_function_privilege('authenticated', p.oid, 'execute')),
c4 as (select count(*) n from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'legajo_supervisores_accesos' and grantee in ('anon', 'authenticated')),
c5 as (select case when public.puede_ver_legajo_supervisores_actual() then 1 else 0 end n),
c6 as (select count(*) n from pasan),
c7 as (select count(*) n from autorizados_esperados e where e.id not in (select id from pasan)),
c8 as (select count(*) n from pasan where id not in (select id from autorizados_esperados)),
c9 as (select count(*) n from pasan p join public.usuarios u on u.id = p.id
       where u.puesto_organizacional in ('supervisor', 'jefe_supervisores', 'vigilador')
         and u.id <> '023769de-9e99-481a-9caa-c604ef56b14b'),
c10 as (select case when public.puede_ver_legajo_supervisores('69493cc2-15d6-4618-893e-4a9b1d044df8') then 1 else 0 end n), -- Sergio
c11 as (select count(*) n from public.usuarios u where u.estado = 'activo' and u.puesto_organizacional = 'administracion'
         and u.id not in (select usuario_id from public.legajo_supervisores_accesos) and public.puede_ver_legajo_supervisores(u.id)),
c12 as (select count(*) n from pg_policies where schemaname = 'public' and tablename = 'supervisor_route_points'
         and qual ilike '%legajo%')
select 1 o, '5 funciones SECURITY DEFINER' control, '5' esperado, n::text obtenido, n = 5 ok from c1
union all select 2,  'Sin execute para anon', '0', n::text, n = 0 from c2
union all select 3,  'Permiso por id no expuesto a authenticated', '0', n::text, n = 0 from c3
union all select 4,  'Tabla de autorizaciones sin grants para anon/authenticated', '0', n::text, n = 0 from c4
union all select 5,  'Permiso niega sin sesión', '0', n::text, n = 0 from c5
union all select 6,  'Usuarios activos con acceso', '7', n::text, n = 7 from c6
union all select 7,  'Autorizados esperados sin acceso', '0', n::text, n = 0 from c7
union all select 8,  'Con acceso y no esperados', '0', n::text, n = 0 from c8
union all select 9,  'Supervisores/jefes con zona/vigiladores con acceso', '0', n::text, n = 0 from c9
union all select 10, 'Sergio Martínez sin acceso', '0', n::text, n = 0 from c10
union all select 11, 'Administración NO autorizada nominalmente con acceso', '0', n::text, n = 0 from c11
union all select 12, 'RLS de supervisor_route_points sin cambios', '0', n::text, n = 0 from c12
order by 1;
