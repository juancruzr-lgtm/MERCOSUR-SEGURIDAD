begin;
drop function if exists public.marcar_exportada_visual(uuid);
alter table public.liquidacion_periodo drop column if exists exportada_at;
alter table public.liquidacion_periodo drop column if exists exportada_por;
alter table public.liquidacion_concepto_catalogo drop column if exists exporta_visual;
alter table public.liquidacion_concepto_catalogo drop column if exists manda_cantidad;
alter table public.liquidacion_concepto_catalogo drop column if exists manda_importe;
commit;
