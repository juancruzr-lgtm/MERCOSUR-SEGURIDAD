-- Rollback de 20261213120000_facturacion_fecha_emision_prefactura.sql
-- Se pierden las fechas de emisión cargadas en prefacturas no emitidas (quedan en fact_historial).
begin;
drop function if exists public.fact_prefactura_fecha_emision(uuid, date);
alter table public.fact_prefacturas drop column if exists fecha_emision_prevista;
commit;
