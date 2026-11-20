-- Verificación post-migración 20261220120000_facturacion_cargos_sin_factura. Sólo lectura; cada fila ok = true.
select 'tabla con RLS' as control, (select relrowsecurity from pg_class where oid = 'public.fact_cargos'::regclass) as ok;
select 'sin escritura directa' as control,
       not has_table_privilege('authenticated', 'public.fact_cargos', 'insert')
       and not has_table_privilege('authenticated', 'public.fact_cargos', 'update')
       and not has_table_privilege('authenticated', 'public.fact_cargos', 'delete')
       and not has_table_privilege('anon', 'public.fact_cargos', 'select') as ok;
select 'funciones sólo para authenticated' as control,
       bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) as ok
  from unnest(array['public.fact_cargo_registrar(uuid, jsonb)', 'public.fact_cargo_anular(uuid, text)', 'public.fact_aplicar_cargo(uuid, uuid, bigint, jsonb)']) f;
select 'aplicaciones con un solo destino' as control,
       not exists (select 1 from public.fact_aplicaciones
                   where (comprobante_id is not null)::int + (saldo_inicial_id is not null)::int + (cargo_id is not null)::int <> 1) as ok;
select 'ningún cargo con más aplicado que su importe' as control, not exists (select 1 from public.fact_v_cargos where saldo_c < 0) as ok;
select 'ningún cobro con más aplicado que su importe' as control,
       not exists (select 1 from public.fact_cobros c where c.anulado_at is null and c.importe_c <
                   (select coalesce(sum(importe_c), 0) from public.fact_aplicaciones a where a.cobro_id = c.id and a.revertida_at is null)) as ok;
