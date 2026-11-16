-- Verificación post-migración 20261213180000_facturacion_cliente_asocia_comprobantes
-- Sólo lectura. Cada fila debe dar ok = true; la última lista los receptores que siguen sin cliente.

select 'alta de cliente asocia comprobantes' as control,
       pg_get_functiondef('public.fact_cliente_guardar(uuid, jsonb, integer)'::regprocedure) like '%asociado_cliente%'
       and pg_get_functiondef('public.fact_cliente_guardar(uuid, jsonb, integer)'::regprocedure) like '%facturacion_gate()%' as ok;

select 'ningún comprobante sin cliente teniendo cliente con su CUIT' as control,
       not exists (select 1 from public.fact_comprobantes c join public.fact_clientes k
                     on regexp_replace(coalesce(k.cuit, ''), '\D', '', 'g') = regexp_replace(coalesce(c.doc_nro_receptor, ''), '\D', '', 'g')
                    where c.cliente_id is null and c.ambiente = 'produccion' and k.cuit is not null) as ok;

select regexp_replace(doc_nro_receptor, '\D', '', 'g') as cuit, max(receptor_nombre) as receptor, count(*) as comprobantes
  from public.fact_comprobantes where cliente_id is null and ambiente = 'produccion' group by 1 order by 3 desc;
