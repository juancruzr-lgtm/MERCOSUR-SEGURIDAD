-- Verificación post-migración 20261220130000_facturacion_anular_retencion. Sólo lectura; cada fila ok = true.
select 'función sólo para authenticated' as control,
       has_function_privilege('authenticated', 'public.fact_retencion_anular(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.fact_retencion_anular(uuid, text)', 'execute') as ok;
select 'retenciones anuladas sin aplicaciones vigentes' as control,
       not exists (select 1 from public.fact_aplicaciones a join public.fact_retenciones r on r.id = a.retencion_id
                   where r.estado = 'anulada' and a.revertida_at is null) as ok;
