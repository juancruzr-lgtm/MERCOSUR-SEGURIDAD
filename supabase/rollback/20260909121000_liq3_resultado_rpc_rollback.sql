begin;
drop function if exists public.registrar_enviado_visual(uuid,jsonb);
drop function if exists public.importar_resultado_visual(uuid,text,text,jsonb,jsonb);
commit;
