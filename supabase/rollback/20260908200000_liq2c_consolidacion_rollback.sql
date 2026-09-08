begin;
drop function if exists public.consolidar_periodo(uuid,jsonb);
drop table if exists public.liquidacion_consolidada;
alter table public.liquidacion_periodo drop column if exists consolidado_at;
alter table public.liquidacion_periodo drop column if exists consolidado_por;
alter table public.liquidacion_periodo drop constraint if exists liquidacion_periodo_estado_check;
alter table public.liquidacion_periodo
  add constraint liquidacion_periodo_estado_check
  check (estado = any (array['borrador','revision','cerrado','exportado']));
commit;
