-- Rollback de 20261210110000_facturacion_plazo_pago_30_por_defecto.
-- 1. Saca los valores por defecto de los contratos nuevos.
-- 2. Devuelve a sus valores anteriores sólo los contratos que cambió la migración y que nadie volvió a tocar
--    (si alguien cargó otro plazo después, se respeta). Deja el registro en el historial.
begin;
alter table public.fact_contratos alter column dias_vencimiento drop default;
alter table public.fact_contratos alter column pago_evento drop default;

with migrados as (
  select distinct on (h.entidad_id) h.entidad_id as id, h.datos
    from public.fact_historial h
   where h.entidad = 'contrato' and h.accion = 'condiciones_comerciales' and h.datos->>'migracion' = '20261210110000'
   order by h.entidad_id, h.at desc
), revertidos as (
  update public.fact_contratos k set
    dias_vencimiento = nullif(m.datos->'anteriores'->>'dias_vencimiento', '')::int,
    pago_evento = nullif(m.datos->'anteriores'->>'pago_evento', ''),
    version = k.version + 1,
    updated_at = now()
  from migrados m
  where k.id = m.id
    and k.dias_vencimiento is not distinct from nullif(m.datos->'nuevas'->>'dias_vencimiento', '')::int
    and k.pago_evento is not distinct from nullif(m.datos->'nuevas'->>'pago_evento', '')
  returning k.id
)
insert into public.fact_historial (entidad, entidad_id, accion, datos, por)
select 'contrato', r.id, 'condiciones_comerciales',
  jsonb_build_object('motivo', 'Rollback de 20261210110000: vuelve al plazo anterior', 'migracion', '20261210110000_rollback'), null
from revertidos r;
commit;
