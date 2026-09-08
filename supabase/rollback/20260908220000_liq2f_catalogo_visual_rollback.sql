begin;
-- Los conceptos sembrados por esta migración tienen politica no nula.
delete from public.liquidacion_concepto_catalogo where politica is not null;
drop index if exists public.ux_liq_catalogo_codigo;
alter table public.liquidacion_concepto_catalogo drop column if exists entrada;
alter table public.liquidacion_concepto_catalogo drop column if exists politica;
alter table public.liquidacion_concepto_catalogo drop column if exists formula;
alter table public.liquidacion_concepto_catalogo drop column if exists tipo_visual;
commit;
