-- Rollback 20261220100000_facturacion_reclamos_cobranza: quita las funciones y la tabla de reclamos.
-- ATENCIÓN: borra los reclamos cargados. Exportar fact_reclamos antes si tiene datos.
drop function if exists public.fact_reclamo_anular(uuid, text);
drop function if exists public.fact_reclamo_actualizar(uuid, jsonb);
drop function if exists public.fact_reclamo_registrar(uuid, jsonb);
drop table if exists public.fact_reclamos;
