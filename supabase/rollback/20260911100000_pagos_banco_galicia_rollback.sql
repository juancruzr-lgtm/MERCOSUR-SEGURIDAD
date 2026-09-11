-- ROLLBACK · PAGOS banco Galicia (20260911100000)
begin;
drop function if exists public.pagos_sueldos_banco(uuid);
drop function if exists public.pagos_extras_banco(uuid);
notify pgrst, 'reload schema';
commit;
