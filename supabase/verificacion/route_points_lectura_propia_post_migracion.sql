-- Verificación posterior a aplicar 20261031120000 (route points: lectura propia).
-- Una sola consulta, sólo lee. Si alguna fila da ok = false, correr el rollback.

select 'Sin política de lectura por rol admin' as control, '0' as esperado,
       count(*)::text as obtenido, count(*) = 0 as ok
from pg_policies
where schemaname = 'public' and tablename = 'supervisor_route_points'
  and policyname = 'Admin lee todos los recorridos'
union all
select 'Ninguna política SELECT menciona rol admin', '0', count(*)::text, count(*) = 0
from pg_policies
where schemaname = 'public' and tablename = 'supervisor_route_points'
  and cmd = 'SELECT' and qual ilike '%admin%'
union all
select 'Política de lectura propia creada', '1', count(*)::text, count(*) = 1
from pg_policies
where schemaname = 'public' and tablename = 'supervisor_route_points'
  and policyname = 'Usuario lee sus propios recorridos' and cmd = 'SELECT'
union all
select 'Políticas totales (insert + 2 lectura propia)', '3', count(*)::text, count(*) = 3
from pg_policies
where schemaname = 'public' and tablename = 'supervisor_route_points'
union all
select 'INSERT sin cambios (sólo rol supervisor, propio)', '1', count(*)::text, count(*) = 1
from pg_policies
where schemaname = 'public' and tablename = 'supervisor_route_points' and cmd = 'INSERT'
  and with_check ilike '%auth.uid()%' and with_check ilike '%supervisor_id%' and with_check ilike '%''supervisor''%'
union all
select 'RLS activa en la tabla', 'true', c.relrowsecurity::text, c.relrowsecurity
from pg_class c where c.oid = 'public.supervisor_route_points'::regclass
union all
select 'Funciones del legajo siguen SECURITY DEFINER de postgres', '2', count(*)::text, count(*) = 2
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
  and p.proname in ('legajo_supervisor_recorrido', 'legajo_supervisores_guardias');
