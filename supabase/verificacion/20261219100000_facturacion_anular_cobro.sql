-- Verificación post-migración 20261219100000_facturacion_anular_cobro. Sólo lectura; cada fila ok = true.
select 'función existe' as control, to_regprocedure('public.fact_cobro_anular_completo(uuid, text)') is not null as ok;
select 'permisos' as control,
       has_function_privilege('authenticated', 'public.fact_cobro_anular_completo(uuid, text)', 'execute')
       and not has_function_privilege('anon', 'public.fact_cobro_anular_completo(uuid, text)', 'execute') as ok;
select 'ningún cobro anulado con aplicaciones vigentes' as control,
       not exists (select 1 from public.fact_cobros c join public.fact_aplicaciones a on a.cobro_id = c.id
                   where c.anulado_at is not null and a.revertida_at is null) as ok;
