-- ROLLBACK de 20260909200000_liq_periodo_anular.sql
drop function if exists public.eliminar_periodo_liquidacion(uuid,boolean,text);
drop function if exists public.contenido_periodo_liquidacion(uuid);

-- Volver el constraint de estado a la versión previa (sin 'anulado').
-- Requiere que no existan períodos en estado 'anulado' (moverlos antes).
alter table public.liquidacion_periodo drop constraint if exists liquidacion_periodo_estado_check;
alter table public.liquidacion_periodo
  add constraint liquidacion_periodo_estado_check
  check (estado = any (array['borrador','revision','consolidada','exportada','liquidada']));

alter table public.liquidacion_periodo drop column if exists anulado_at;
alter table public.liquidacion_periodo drop column if exists anulado_por;
alter table public.liquidacion_periodo drop column if exists anulado_motivo;
