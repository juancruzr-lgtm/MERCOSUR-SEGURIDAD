-- Verificación posterior a 20261025120000_protocolos_ultima_rige.sql.
-- Sólo lee. Una sola sentencia: el editor de Supabase muestra el último select.
-- Todas las filas deben dar ok = true.
select 'protocolo_guardar con 7 argumentos' as control,
       (select count(*) from pg_proc where proname = 'protocolo_guardar' and pronargs = 7)::text as obtenido,
       (select count(*) from pg_proc where proname = 'protocolo_guardar' and pronargs = 7) = 1 as ok
union all
select 'protocolo_hacer_vigente con 3 argumentos',
       (select count(*) from pg_proc where proname = 'protocolo_hacer_vigente' and pronargs = 3)::text,
       (select count(*) from pg_proc where proname = 'protocolo_hacer_vigente' and pronargs = 3) = 1
union all
select 'authenticated ejecuta guardar y hacer_vigente',
       (has_function_privilege('authenticated', 'public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean)', 'execute')
        and has_function_privilege('authenticated', 'public.protocolo_hacer_vigente(uuid, uuid, boolean)', 'execute'))::text,
       has_function_privilege('authenticated', 'public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean)', 'execute')
        and has_function_privilege('authenticated', 'public.protocolo_hacer_vigente(uuid, uuid, boolean)', 'execute')
union all
select 'anon no ejecuta',
       (has_function_privilege('anon', 'public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean)', 'execute')
        or has_function_privilege('anon', 'public.protocolo_hacer_vigente(uuid, uuid, boolean)', 'execute'))::text,
       not (has_function_privilege('anon', 'public.protocolo_guardar(uuid, uuid, text, text, uuid, uuid, boolean)', 'execute')
        or has_function_privilege('anon', 'public.protocolo_hacer_vigente(uuid, uuid, boolean)', 'execute'))
union all
select 'La migración no puso nada en vigencia',
       (select count(*) from public.protocolo_versiones where estado = 'vigente')::text,
       (select count(*) from public.protocolo_versiones where estado = 'vigente') = 0
union all
select 'Los 7 de objetivo dudoso siguen en borrador',
       (select count(*) from public.protocolo_versiones where asociacion = 'pendiente_validacion' and estado = 'borrador')::text,
       (select count(*) from public.protocolo_versiones where asociacion = 'pendiente_validacion' and estado = 'borrador') = 7;
