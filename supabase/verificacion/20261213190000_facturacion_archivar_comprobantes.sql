-- Verificación post-migración 20261213190000_facturacion_archivar_comprobantes
-- Sólo lectura. Cada fila debe dar ok = true.

select 'columnas de archivo' as control,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fact_comprobantes'
         and column_name in ('archivado_at', 'archivado_por', 'archivado_motivo')) = 3 as ok;

select 'saldos sin archivados' as control,
       not exists (select 1 from public.fact_v_saldos s join public.fact_comprobantes c on c.id = s.comprobante_id where c.archivado_at is not null) as ok;

select 'ex clientes archivados' as control,
       not exists (select 1 from public.fact_comprobantes where ambiente = 'produccion' and archivado_at is null and cliente_id is null
                    and regexp_replace(coalesce(doc_nro_receptor, ''), '\D', '', 'g') in ('30719220459', '30602764032', '30708407611')) as ok;

select 'todo archivado tiene historial' as control,
       not exists (select 1 from public.fact_comprobantes c where c.archivado_at is not null
                    and not exists (select 1 from public.fact_historial h where h.entidad = 'comprobante' and h.entidad_id = c.id and h.accion = 'archivado')) as ok;

select 'permisos' as control,
       has_function_privilege('authenticated', 'public.fact_comprobante_archivar(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.fact_comprobante_archivar(uuid, text)', 'execute') as ok;
