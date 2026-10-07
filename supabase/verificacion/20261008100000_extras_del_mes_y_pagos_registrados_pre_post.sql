-- VERIFICACIÓN · Extras del mes + pagos registrados (20261008100000)
select 'fn_destinatarios' c, (to_regprocedure('public.pagos_banco_destinatarios()') is not null)::text v, 'POST=true' e
union all select 'fn_registrar', (to_regprocedure('public.registrar_pago_banco(uuid,text,text,text,jsonb)') is not null)::text, 'POST=true'
union all select 'fn_anular', (to_regprocedure('public.anular_pago_banco(uuid,text)') is not null)::text, 'POST=true'
union all select 'tablas_pago', (to_regclass('public.liquidacion_pago_lote') is not null and to_regclass('public.liquidacion_pago_registrado') is not null)::text, 'POST=true'
union all select 'rls', (select bool_and(relrowsecurity)::text from pg_class where oid in (to_regclass('public.liquidacion_pago_lote'), to_regclass('public.liquidacion_pago_registrado'))), 'POST=true'
union all select 'anon_sin_execute', (not has_function_privilege('anon','public.registrar_pago_banco(uuid,text,text,text,jsonb)','execute'))::text, 'POST=true'
union all select 'pagos_registrados', (select count(*)::text from public.liquidacion_pago_registrado), 'POST=0';
-- POST: el archivo de SUELDOS no cambia respecto de PRE (comparar total y filas por período).
-- select count(*), sum(importe) from public.pagos_sueldos_banco(:periodo);
