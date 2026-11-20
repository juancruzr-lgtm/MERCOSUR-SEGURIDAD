-- Verificación post-migración 20261220100000_facturacion_reclamos_cobranza. Sólo lectura; cada fila ok = true.
select 'tabla con RLS' as control, (select relrowsecurity from pg_class where oid = 'public.fact_reclamos'::regclass) as ok;
select 'sin escritura directa' as control,
       not has_table_privilege('authenticated', 'public.fact_reclamos', 'insert')
       and not has_table_privilege('authenticated', 'public.fact_reclamos', 'update')
       and not has_table_privilege('authenticated', 'public.fact_reclamos', 'delete')
       and not has_table_privilege('anon', 'public.fact_reclamos', 'select') as ok;
select 'funciones con permiso sólo para authenticated' as control,
       bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')) as ok
  from unnest(array['public.fact_reclamo_registrar(uuid, jsonb)', 'public.fact_reclamo_actualizar(uuid, jsonb)', 'public.fact_reclamo_anular(uuid, text)']) f;
select 'reclamos de un solo cliente' as control,
       not exists (select 1 from public.fact_reclamos r cross join unnest(r.comprobante_ids) c
                   join public.fact_comprobantes k on k.id = c where k.cliente_id is distinct from r.cliente_id) as ok;
