begin;
delete from public.liquidacion_persona where origen in ('exclusion','visual_reconciliacion');
update public.liquidacion_persona set motivo = null where motivo like 'No tiene recibo%';
alter table public.liquidacion_persona drop constraint if exists liquidacion_persona_estado_liquidable_check;
alter table public.liquidacion_persona
  add constraint liquidacion_persona_estado_liquidable_check
  check (estado_liquidable = any (array['activo','baja']));
alter table public.liquidacion_persona drop column if exists motivo;
commit;
