-- Rollback 20261220130000_facturacion_anular_retencion: quita la función. Las retenciones ya anuladas siguen anuladas.
drop function if exists public.fact_retencion_anular(uuid, text);
