-- Verificación post-migración 20261220140000_facturacion_oc_consumo_por_factura. Sólo lectura; cada fila ok = true.
select 'funciones sólo para authenticated' as control,
       bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) as ok
  from unnest(array['public.fact_oc_consumo_comprobante(uuid, uuid)', 'public.fact_oc_consumo_anular(uuid, text)']) f;
select 'todo consumo tiene prefactura o factura' as control,
       not exists (select 1 from public.fact_oc_consumos where prefactura_id is null and comprobante_id is null) as ok;
select 'facturas descontadas del mismo cliente que la OC' as control,
       not exists (select 1 from public.fact_oc_consumos c join public.fact_ordenes_compra o on o.id = c.oc_id
                   join public.fact_comprobantes k on k.id = c.comprobante_id where k.cliente_id is distinct from o.cliente_id) as ok;
