-- Verificación posterior de 20261203130000_facturacion_reagrupar_atomico (sólo lectura, una sentencia).
select 'funcion existe y es security definer' control, exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'fact_prefacturas_reagrupar' and p.prosecdef) ok
union all select 'search_path fijo', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'fact_prefacturas_reagrupar' and array_to_string(p.proconfig, ',') like '%search_path=public, pg_catalog%')
union all select 'pasa por facturacion_gate', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'fact_prefacturas_reagrupar' and pg_get_functiondef(p.oid) like '%public.facturacion_gate()%')
union all select 'anon no la ejecuta', not has_function_privilege('anon', 'public.fact_prefacturas_reagrupar(jsonb, jsonb)', 'execute')
union all select 'authenticated la ejecuta', has_function_privilege('authenticated', 'public.fact_prefacturas_reagrupar(jsonb, jsonb)', 'execute')
union all select 'no cambió ninguna prefactura (sólo agrega la función)', not exists (select 1 from public.fact_prefacturas where updated_at > now() - interval '1 minute');
