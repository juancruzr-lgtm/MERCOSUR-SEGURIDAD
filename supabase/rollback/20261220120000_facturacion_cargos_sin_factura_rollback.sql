-- Rollback 20261220120000_facturacion_cargos_sin_factura: quita los cargos sin factura (remitos).
-- ATENCIÓN: borra los cargos y las aplicaciones de cobros a cargos (los cobros quedan sin aplicar por ese importe).
-- Exportar fact_cargos y las aplicaciones con cargo_id antes si tienen datos.
drop function if exists public.fact_aplicar_cargo(uuid, uuid, bigint, jsonb);
drop function if exists public.fact_cargo_anular(uuid, text);
drop function if exists public.fact_cargo_registrar(uuid, jsonb);
drop view if exists public.fact_v_cargos;
delete from public.fact_aplicaciones where cargo_id is not null;
drop index if exists public.ix_fact_aplic_cargo;
drop index if exists public.ux_fact_aplicacion_vigente;
alter table public.fact_aplicaciones drop constraint if exists fact_aplicaciones_destino_unico;
alter table public.fact_aplicaciones drop column if exists cargo_id;
alter table public.fact_aplicaciones add constraint fact_aplicaciones_check1
  check ((comprobante_id is not null)::int + (saldo_inicial_id is not null)::int = 1);
create unique index ux_fact_aplicacion_vigente on public.fact_aplicaciones
  (coalesce(cobro_id, retencion_id), coalesce(comprobante_id, saldo_inicial_id)) where revertida_at is null;
drop table if exists public.fact_cargos;
