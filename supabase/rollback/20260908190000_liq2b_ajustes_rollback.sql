begin;
drop function if exists public.aplicar_ajustes_liquidacion(uuid,text,text,text,jsonb);
drop table if exists public.liquidacion_ajuste;
commit;
