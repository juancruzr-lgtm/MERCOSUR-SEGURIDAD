-- Verificación posterior a aplicar 20261101120000 (lista única de legajos y evaluaciones).
-- Una sola consulta de lectura. Si alguna fila da ok = false, NO desplegar.

with
esperados(id) as (values
  ('3a8e3c04-f4f5-48c4-8830-73edccb73667'::uuid),  -- Juan Cruz Romero
  ('5a8e3f70-77ef-4f89-8332-b9878f32a293'::uuid),  -- Facundo Romero
  ('3731aa27-ce78-4817-8faa-66ad1edfabaa'::uuid),  -- Rodolfo Romero
  ('023769de-9e99-481a-9caa-c604ef56b14b'::uuid),  -- Aldo Monzón
  ('1384746c-0520-4ebe-8d7b-17788d833cba'::uuid),  -- Laura M.
  ('a2cd1908-7e9d-4bf4-8407-ecf644e1f351'::uuid),  -- Joel Juárez
  ('eecd4b5c-095d-4062-be10-25e78ea9f499'::uuid)   -- Andrea Narvarte
),
pasan as (select u.id from public.usuarios u where u.estado = 'activo' and public.puede_ver_legajo_supervisores(u.id)),
c1 as (select count(*) n from public.legajo_supervisores_accesos),
c2 as (select count(*) n from pasan),
c3 as (select count(*) n from esperados e where e.id not in (select id from pasan)),
c4 as (select count(*) n from pasan where id not in (select id from esperados)),
c5 as (select case when public.puede_ver_legajo_supervisores('69493cc2-15d6-4618-893e-4a9b1d044df8') then 1 else 0 end n), -- Sergio
c6 as (select count(*) n from pasan p join public.usuarios u on u.id = p.id
       where u.puesto_organizacional in ('supervisor', 'vigilador') or u.puesto_organizacional is null),
c7 as (select count(*) n from public.usuarios u where u.estado = 'activo'
         and u.puesto_organizacional in ('gerencia', 'direccion_operativa', 'administracion')
         and u.id not in (select id from esperados) and public.puede_ver_legajo_supervisores(u.id)),
c8 as (select case when pg_get_functiondef('public.puede_evaluar_supervisores_actual()'::regprocedure)
                        ilike '%puede_ver_legajo_supervisores_actual()%' then 1 else 0 end n),
c9 as (select case when public.puede_evaluar_supervisores_actual() then 1 else 0 end n),
c10 as (select count(*) n from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'legajo_supervisores_accesos' and grantee in ('anon', 'authenticated')),
c11 as (select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'public' and p.proname = 'puede_ver_legajo_supervisores'
          and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))
select 1 o, 'Filas en la lista de autorizaciones' control, '7' esperado, n::text obtenido, n = 7 ok from c1
union all select 2,  'Usuarios activos con acceso', '7', n::text, n = 7 from c2
union all select 3,  'Autorizados esperados sin acceso', '0', n::text, n = 0 from c3
union all select 4,  'Con acceso y no esperados', '0', n::text, n = 0 from c4
union all select 5,  'Sergio Martínez sin acceso', '0', n::text, n = 0 from c5
union all select 6,  'Supervisores o vigiladores con acceso', '0', n::text, n = 0 from c6
union all select 7,  'Gerencia/Dirección/Administración fuera de la lista con acceso', '0', n::text, n = 0 from c7
union all select 8,  'La evaluación usa la misma lista', '1', n::text, n = 1 from c8
union all select 9,  'Evaluación niega sin sesión', '0', n::text, n = 0 from c9
union all select 10, 'Lista sin grants para anon/authenticated', '0', n::text, n = 0 from c10
union all select 11, 'Permiso por id no expuesto', '0', n::text, n = 0 from c11
order by 1;
