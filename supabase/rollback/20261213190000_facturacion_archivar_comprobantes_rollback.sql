-- Rollback de 20261213190000_facturacion_archivar_comprobantes.sql
-- Los comprobantes archivados vuelven a sumar en saldos y deuda. El historial de los archivados queda en
-- fact_historial (accion = 'archivado').
begin;
drop function if exists public.fact_comprobante_archivar(uuid, text);
drop function if exists public.fact_comprobante_desarchivar(uuid, text);
create or replace view public.fact_v_saldos with (security_invoker = true) as
select c.id as comprobante_id, c.cliente_id, c.tipo, c.punto_venta, c.numero, c.fecha_emision, c.vto_pago, c.total_c,
       coalesce(nc.t, 0) as nc_c, coalesce(nd.t, 0) as nd_c, coalesce(ap.t, 0) as aplicado_c,
       c.total_c + coalesce(nd.t, 0) - coalesce(nc.t, 0) - coalesce(ap.t, 0) as saldo_c
from public.fact_comprobantes c
left join lateral (select sum(n.total_c) t from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (3, 8, 203) and n.ambiente = 'produccion') nc on true
left join lateral (select sum(n.total_c) t from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (2, 7, 202) and n.ambiente = 'produccion') nd on true
left join lateral (select sum(a.importe_c) t from public.fact_aplicaciones a where a.comprobante_id = c.id and a.revertida_at is null) ap on true
where c.ambiente = 'produccion' and (c.tipo in (1, 6, 201) or (c.tipo in (2, 7, 202) and c.asociado_id is null));
alter table public.fact_comprobantes
  drop column if exists archivado_at,
  drop column if exists archivado_por,
  drop column if exists archivado_motivo;
commit;
