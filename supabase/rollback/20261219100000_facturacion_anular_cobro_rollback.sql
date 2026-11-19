-- Rollback 20261219100000_facturacion_anular_cobro: quita la función (los cobros ya anulados quedan anulados).
drop function if exists public.fact_cobro_anular_completo(uuid, text);
