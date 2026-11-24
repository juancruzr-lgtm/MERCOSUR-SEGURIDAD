-- Verificación de 20261223120000_evaluacion_vigiladores_por_supervisor.
-- Una sola consulta (el editor de Supabase muestra sólo el último select).
-- Todas las filas deben decir ok = true.

select 'tabla existe' as control,
       to_regclass('public.evaluaciones_vigilador_supervisor') is not null as ok,
       null::text as detalle
union all
select 'RLS activa',
       (select relrowsecurity from pg_class where oid = 'public.evaluaciones_vigilador_supervisor'::regclass),
       null
union all
select 'authenticated sólo lee',
       has_table_privilege('authenticated', 'public.evaluaciones_vigilador_supervisor', 'select')
       and not has_table_privilege('authenticated', 'public.evaluaciones_vigilador_supervisor', 'insert')
       and not has_table_privilege('authenticated', 'public.evaluaciones_vigilador_supervisor', 'update')
       and not has_table_privilege('authenticated', 'public.evaluaciones_vigilador_supervisor', 'delete')
       and not has_table_privilege('authenticated', 'public.evaluaciones_vigilador_supervisor', 'truncate'),
       null
union all
select 'anon sin acceso',
       not has_table_privilege('anon', 'public.evaluaciones_vigilador_supervisor', 'select'),
       null
union all
select 'función interna cerrada',
       not has_function_privilege('authenticated', 'public.evaluacion_vigiladores_de_zona(uuid)', 'execute'),
       null
union all
select 'RPC del supervisor abiertas a authenticated',
       has_function_privilege('authenticated', 'public.evaluacion_vigiladores_mias()', 'execute')
       and has_function_privilege('authenticated',
         'public.evaluacion_vigilador_guardar(uuid, integer, integer, integer, integer, integer, integer, integer, text, text, text)', 'execute')
       and not has_function_privilege('anon', 'public.evaluacion_vigiladores_mias()', 'execute'),
       null
union all
select 'vigiladores por supervisor con zona',
       true,
       (select string_agg(u.apellido || ': ' || n::text, ', ' order by u.apellido)
          from (select sz.supervisor_id, (select count(*) from public.evaluacion_vigiladores_de_zona(sz.supervisor_id)) as n
                  from (select distinct supervisor_id from public.supervisor_zonas) sz) c
          join public.usuarios u on u.id = c.supervisor_id);
