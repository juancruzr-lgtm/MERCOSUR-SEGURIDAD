-- Verificación posterior a aplicar 20261030120000 (legajo operativo de supervisores).
-- Una sola consulta de lectura (el editor muestra sólo el último resultado).
-- Si alguna fila da ok = false, NO desplegar.

with
c1 as (select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.prosecdef and p.proname in (
         'puede_ver_legajo_supervisores_actual', 'legajo_supervisores_guardias',
         'legajo_supervisores_supervisiones', 'legajo_supervisor_recorrido')),
c2 as (select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname in (
         'puede_ver_legajo_supervisores_actual', 'legajo_supervisores_guardias',
         'legajo_supervisores_supervisiones', 'legajo_supervisor_recorrido')
         and has_function_privilege('anon', p.oid, 'execute')),
c3 as (select case when public.puede_ver_legajo_supervisores_actual() then 1 else 0 end n),
c4 as (select count(*) n from pg_policies where schemaname = 'public' and tablename = 'supervisor_route_points'
         and cmd in ('SELECT', 'ALL') and qual ilike '%jefe_supervisores%')
select 1 o, '4 funciones SECURITY DEFINER' control, '4' esperado, n::text obtenido, n = 4 ok from c1
union all select 2, 'Sin execute para anon', '0', n::text, n = 0 from c2
union all select 3, 'Permiso niega sin sesión', '0', n::text, n = 0 from c3
union all select 4, 'RLS de supervisor_route_points sin cambios (no abre a jefes)', '0', n::text, n = 0 from c4
order by 1;
