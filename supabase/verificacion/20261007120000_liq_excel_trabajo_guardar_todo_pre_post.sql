-- VERIFICACIÓN · Excel de trabajo: guardar todo (20261007120000)
-- PRE: todo false / 0.  POST: todo true; filas_parametros arranca en 0.
select 'tabla_parametro_mes' chequeo, (to_regclass('public.liquidacion_parametro_mes') is not null)::text v, 'POST=true' e
union all select 'col_valor_texto',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'liquidacion_ajuste' and column_name = 'valor_texto')::text, 'POST=true'
union all select 'fn_guardar_reimport',
  (to_regprocedure('public.guardar_reimport_excel_trabajo(uuid,text,text,text,jsonb,jsonb,jsonb)') is not null)::text, 'POST=true'
union all select 'rls_parametro_mes',
  coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.liquidacion_parametro_mes')), 'false'), 'POST=true'
union all select 'anon_sin_execute',
  (not has_function_privilege('anon', 'public.guardar_reimport_excel_trabajo(uuid,text,text,text,jsonb,jsonb,jsonb)', 'execute'))::text, 'POST=true'
union all select 'ajustes_intactos', (select count(*) from public.liquidacion_ajuste)::text, 'PRE = POST (no toca datos)';
