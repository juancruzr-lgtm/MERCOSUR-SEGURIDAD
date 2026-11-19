-- Rollback 20261219110000_facturacion_licitaciones_horas. Las horas previas cargadas se pierden al quitar las columnas.
drop function if exists public.fact_licitacion_detalle(uuid);
drop function if exists public.fact_licitaciones_resumen();
drop function if exists public.fact_turno_horas(time, time);
drop function if exists public.fact_oc_horas_previas(uuid, numeric, date, text);
alter table public.fact_ordenes_compra drop column if exists horas_previas_nota, drop column if exists horas_previas_hasta, drop column if exists horas_previas;
