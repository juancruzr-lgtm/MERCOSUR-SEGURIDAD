begin;
delete from public.liquidacion_concepto_permanente where persona_id = (select id from public.liquidacion_persona where cuil='23142066599') and importe is null and motivo like 'padrón inicial%';
alter table public.liquidacion_concepto_permanente drop column if exists persona_id;
alter table public.liquidacion_periodo_empleado drop column if exists persona_id;
-- Nota: empleado_id vuelve a poder ser NOT NULL sólo si no quedaron filas nulas.
commit;
