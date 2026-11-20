-- Verificación post-migración 20261220110000_facturacion_cobro_idempotente. Sólo lectura; cada fila ok = true.
select 'alta con id del cliente' as control, pg_get_functiondef('public.fact_cobro_registrar(jsonb)'::regprocedure) like '%v_pedido%' as ok;
select 'control de duplicados de 2 minutos' as control, pg_get_functiondef('public.fact_cobro_registrar(jsonb)'::regprocedure) like '%2 minutes%' as ok;
select 'permiso sólo authenticated' as control,
       has_function_privilege('authenticated', 'public.fact_cobro_registrar(jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.fact_cobro_registrar(jsonb)', 'execute') as ok;
