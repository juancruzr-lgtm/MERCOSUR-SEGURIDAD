-- Verificación post-migración 20261213160000_facturacion_corregir_texto_comprobante
-- Sólo lectura. Cada fila debe dar ok = true.

select 'columnas de texto del PDF' as control,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fact_comprobantes'
         and column_name in ('texto_pdf', 'conceptos_pdf', 'texto_pdf_version')) = 3 as ok;

select 'permisos de la función' as control,
       has_function_privilege('authenticated', 'public.fact_comprobante_corregir_texto(uuid, text, jsonb, text)', 'execute')
       and not has_function_privilege('anon', 'public.fact_comprobante_corregir_texto(uuid, text, jsonb, text)', 'execute') as ok;

select 'controles en el servidor' as control,
       pg_get_functiondef('public.fact_comprobante_corregir_texto(uuid, text, jsonb, text)'::regprocedure) like '%facturacion_gate()%'
       and pg_get_functiondef('public.fact_comprobante_corregir_texto(uuid, text, jsonb, text)'::regprocedure) like '%emision_app%' as ok;

select 'los datos fiscales siguen protegidos' as control,
       exists (select 1 from pg_trigger where tgname = 'fact_comprobante_inmutable' and not tgisinternal) as ok;

select 'toda corrección tiene historial' as control,
       not exists (select 1 from public.fact_comprobantes c where c.texto_pdf_version > 0
                    and not exists (select 1 from public.fact_historial h where h.entidad = 'comprobante' and h.entidad_id = c.id and h.accion = 'texto_pdf')) as ok;
