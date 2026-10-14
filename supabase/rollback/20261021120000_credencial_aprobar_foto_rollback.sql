-- Rollback de 20261021120000_credencial_aprobar_foto.
begin;
drop function if exists public.credencial_aprobar_foto(uuid, date, text);
notify pgrst, 'reload schema';
commit;
