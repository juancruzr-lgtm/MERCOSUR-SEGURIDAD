-- Verificación post-migración 20261213120000_facturacion_fecha_emision_prefactura
-- Sólo lectura. Cada fila debe dar ok = true.

select 'columna fecha_emision_prevista' as control,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fact_prefacturas' and column_name = 'fecha_emision_prevista') as ok;

select 'permisos de la función' as control,
       has_function_privilege('authenticated', 'public.fact_prefactura_fecha_emision(uuid, date)', 'execute')
       and not has_function_privilege('anon', 'public.fact_prefactura_fecha_emision(uuid, date)', 'execute') as ok;
