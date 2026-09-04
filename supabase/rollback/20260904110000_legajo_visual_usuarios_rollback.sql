-- ROLLBACK · 20260904110000_legajo_visual_usuarios
begin;
alter table public.usuarios drop column if exists legajo_visual;
notify pgrst, 'reload schema';
commit;
