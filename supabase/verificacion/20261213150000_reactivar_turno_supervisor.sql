-- Verificación post-migración 20261213150000_reactivar_turno_supervisor
-- Sólo lectura. Cada fila debe dar ok = true.

select 'acepta supervisor' as control,
       pg_get_functiondef('public.reactivar_turno_anulado_trabajado(uuid, text)'::regprocedure) like '%rol not in (''admin'', ''supervisor'')%' as ok;

select 'sigue controlando zona y evidencia' as control,
       pg_get_functiondef('public.reactivar_turno_anulado_trabajado(uuid, text)'::regprocedure) like '%alcanza_zona_actual%'
       and pg_get_functiondef('public.reactivar_turno_anulado_trabajado(uuid, text)'::regprocedure) like '%hora_salida_real is not null%' as ok;

select 'permisos' as control,
       has_function_privilege('authenticated', 'public.reactivar_turno_anulado_trabajado(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.reactivar_turno_anulado_trabajado(uuid, text)', 'execute') as ok;
