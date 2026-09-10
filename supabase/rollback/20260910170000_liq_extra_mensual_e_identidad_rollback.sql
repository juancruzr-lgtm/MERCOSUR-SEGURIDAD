-- ROLLBACK · EXTRA mensual + identidad (20260910170000)
begin;
drop function if exists public.actualizar_identidad_usuario(uuid,text,text,text);
drop function if exists public.set_extra_mensual(uuid,numeric,text);
drop function if exists public.extra_mensual_vigente(uuid,text);
drop table if exists public.liquidacion_extra_mensual;
notify pgrst, 'reload schema';
commit;
