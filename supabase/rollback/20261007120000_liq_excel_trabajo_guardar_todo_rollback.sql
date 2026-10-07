-- Rollback de 20261007120000_liq_excel_trabajo_guardar_todo
-- ATENCIÓN: borra los parámetros guardados por mes y los textos editados
-- (valor_texto). Exportarlos antes si ya se usaron:
--   select * from public.liquidacion_parametro_mes;
--   select * from public.liquidacion_ajuste where valor_texto is not null;
-- Los ajustes 'celda:*' / 'texto:*' quedan en liquidacion_ajuste; el código previo
-- los ignora. Para quitarlos:
--   delete from public.liquidacion_ajuste where clave like 'celda:%' or clave like 'texto:%';

begin;
drop function if exists public.guardar_reimport_excel_trabajo(uuid,text,text,text,jsonb,jsonb,jsonb);
drop table if exists public.liquidacion_parametro_mes;
alter table public.liquidacion_ajuste drop column if exists valor_texto;
commit;
