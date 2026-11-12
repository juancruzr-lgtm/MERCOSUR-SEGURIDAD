-- Verificación post-migración 20261213110000_facturacion_renglones_texto_horas_facturar
-- Sólo lectura. Cada fila debe dar ok = true.

select 'columna texto_renglon' as control,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fact_contrato_objetivos' and column_name = 'texto_renglon') as ok;

select 'columnas horas a facturar' as control,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fact_horas_aprobaciones'
         and column_name in ('minutos_facturar', 'facturar_motivo', 'facturar_por', 'facturar_at')) = 4 as ok;

select 'horas a facturar con motivo' as control,
       not exists (select 1 from public.fact_horas_aprobaciones where minutos_facturar is not null and nullif(btrim(coalesce(facturar_motivo, '')), '') is null) as ok;

select 'permisos de las funciones' as control,
       has_function_privilege('authenticated', 'public.fact_contrato_objetivo_texto(uuid, text)', 'execute')
       and has_function_privilege('authenticated', 'public.fact_horas_facturar(uuid, integer, text)', 'execute')
       and not has_function_privilege('anon', 'public.fact_contrato_objetivo_texto(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.fact_horas_facturar(uuid, integer, text)', 'execute') as ok;
