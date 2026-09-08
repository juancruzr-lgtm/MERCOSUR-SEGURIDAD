-- ROLLBACK de 20260908170000_liq1b_importacion_auditoria.sql
begin;
drop function if exists public.importar_conceptos_liquidacion(uuid,text,text,text,jsonb);
drop table if exists public.liquidacion_auditoria cascade;
drop table if exists public.liquidacion_importacion cascade;
commit;
