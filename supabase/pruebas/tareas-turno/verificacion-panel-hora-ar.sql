-- Verificación posterior a 20261205200000_tareas_turno_panel_hora_ar.sql.
-- Una sola sentencia (el editor de Supabase muestra sólo el último select).
-- Esperado: todas las filas con ok = true.
select 'panel convierte la hora del turno a hora argentina' as control,
       (pg_get_functiondef('public.tareas_turno_panel(uuid,integer)'::regprocedure)
          ~ 'hora_inicio\) at time zone ''America/Argentina/Buenos_Aires''') as ok
union all
select 'panel: fin del turno también convertido',
       (pg_get_functiondef('public.tareas_turno_panel(uuid,integer)'::regprocedure)
          ~ 'interval ''0'' end\)\s+at time zone ''America/Argentina/Buenos_Aires''')
union all
select 'panel: sigue siendo SECURITY DEFINER',
       (select p.prosecdef from pg_proc p where p.oid = 'public.tareas_turno_panel(uuid,integer)'::regprocedure)
union all
select 'panel: anon sin EXECUTE',
       not has_function_privilege('anon', 'public.tareas_turno_panel(uuid,integer)', 'execute')
union all
select 'panel: authenticated con EXECUTE',
       has_function_privilege('authenticated', 'public.tareas_turno_panel(uuid,integer)', 'execute');
