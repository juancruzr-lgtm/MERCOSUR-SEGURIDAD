-- Verificación posterior de 20261206100000_seguridad_montos_liquidacion_gate.
-- Sólo lectura, una sola sentencia. Todas las filas deben dar ok = true.
with f(firma) as (values
  ('public.sueldo_mensual_vigente(uuid,text)'), ('public.extra_mensual_vigente(uuid,text)'),
  ('public.liquidacion_final_extras_pagadas(uuid,text)'), ('public.liquidacion_final_ya_liquidado(text,text)'))
select 'existe liquidacion_montos_gate()' as control,
       to_regprocedure('public.liquidacion_montos_gate()') is not null as ok
union all select 'liquidacion_montos_gate: authenticated y anon no la ejecutan',
       not has_function_privilege('authenticated', 'public.liquidacion_montos_gate()', 'execute')
       and not has_function_privilege('anon', 'public.liquidacion_montos_gate()', 'execute')
union all select 'las 4 llaman al gate', (select bool_and(p.prosrc like '%liquidacion_montos_gate()%') from f join pg_proc p on p.oid = f.firma::regprocedure)
union all select 'las 4 siguen SECURITY DEFINER y STABLE', (select bool_and(p.prosecdef and p.provolatile = 's') from f join pg_proc p on p.oid = f.firma::regprocedure)
union all select 'las 4 con search_path fijo', (select bool_and(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) from f join pg_proc p on p.oid = f.firma::regprocedure)
union all select 'authenticated y service_role conservan EXECUTE en las 4', (select bool_and(has_function_privilege('authenticated', f.firma, 'execute') and has_function_privilege('service_role', f.firma, 'execute')) from f)
union all select 'anon no ejecuta ninguna de las 4', (select bool_and(not has_function_privilege('anon', f.firma, 'execute')) from f)
union all select 'sin usuario de la app (este editor) siguen respondiendo',
       (select public.liquidacion_final_ya_liquidado('0', '1900-01') = '[]'::jsonb)
       and (select public.liquidacion_final_extras_pagadas('00000000-0000-0000-0000-000000000000', '1900-01') = 0);
