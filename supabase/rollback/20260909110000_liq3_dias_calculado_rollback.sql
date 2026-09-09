begin;
alter table public.liquidacion_dias drop column if exists dias_calculado;
commit;
