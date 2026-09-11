-- VERIFICACIÓN · PAGOS banco Galicia (20260911100000)
select 'fn_sueldos' chequeo, (to_regprocedure('public.pagos_sueldos_banco(uuid)') is not null)::text v, 'POST=true' e
union all select 'fn_extras', (to_regprocedure('public.pagos_extras_banco(uuid)') is not null)::text, 'POST=true';
