-- Rollback 20261220140000_facturacion_oc_consumo_por_factura.
-- ATENCIÓN: anula los consumos cargados por factura (sin prefactura) antes de volver a exigir prefactura_id.
drop function if exists public.fact_oc_consumo_anular(uuid, text);
drop function if exists public.fact_oc_consumo_comprobante(uuid, uuid);
delete from public.fact_oc_consumos where prefactura_id is null;
drop index if exists public.ux_fact_oc_consumo_comprobante;
alter table public.fact_oc_consumos drop constraint if exists fact_oc_consumos_origen;
alter table public.fact_oc_consumos drop column if exists anulado_motivo;
alter table public.fact_oc_consumos drop column if exists comprobante_id;
alter table public.fact_oc_consumos alter column prefactura_id set not null;
