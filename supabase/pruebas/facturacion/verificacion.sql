-- Verificación POSTERIOR a aplicar las 4 migraciones de facturación. SÓLO LECTURA.
-- Una sola sentencia: "ok" debe ser true en todas las filas. Se prueba en la base
-- aislada (supabase/pruebas/facturacion/run.mjs) antes de usarla en producción.
select 'las 4 migraciones registradas' control,
       (select count(distinct name) from supabase_migrations.schema_migrations
         where name in ('20261201120000_facturacion_base', '20261201130000_facturacion_comprobantes_arca',
                        '20261201140000_facturacion_cuentas_corrientes', '20261201150000_facturacion_vencimientos_intereses')) = 4 ok,
       null::text detalle
union all
select 'RLS activa en todas las tablas de facturación',
       not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'fact\_%' and not c.relrowsecurity),
       (select count(*)::text || ' tablas' from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'fact\_%')
union all
select 'anon no lee ni escribe tablas de facturación',
       not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and c.relname like 'fact\_%'
                   and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
                        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))), null
union all
select 'authenticated sólo lee (escribe únicamente por RPC)',
       not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and c.relname like 'fact\_%'
                   and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
                        or has_table_privilege('authenticated', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))), null
union all
select 'anon no ejecuta funciones de facturación',
       not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'fact\_%' or p.proname like 'facturacion\_%')
                   and has_function_privilege('anon', p.oid, 'execute')),
       (select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'fact\_%' or p.proname like 'facturacion\_%')
           and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'bloqueo por baja en todas las tablas',
       not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'fact\_%'
                   and not exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = c.relname and x.policyname = 'acceso_bloqueado_baja')), null
union all
select 'ARCA apagado (producción y homologación)',
       (select coalesce((valor->>'produccion_habilitada')::boolean, true) = false and coalesce((valor->>'homologacion_habilitada')::boolean, true) = false
          from public.fact_config where clave = 'emision'), null
union all
select 'cobranzas, intereses y emisión manual apagados',
       (select coalesce((valor->>'cobranzas')::boolean, true) = false and coalesce((valor->>'intereses')::boolean, true) = false
           and coalesce((valor->>'emision_manual')::boolean, true) = false from public.fact_config where clave = 'modulos'), null
union all
select 'bucket de documentos privado', coalesce((select not public from storage.buckets where id = 'facturacion-documentos'), false), null
union all
select 'políticas de storage creadas',
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('fact_docs_lectura', 'fact_docs_alta')) = 2, null
union all
select 'sin datos cargados todavía (no se tocó nada real)',
       not exists (select 1 from public.fact_clientes) and not exists (select 1 from public.fact_prefacturas) and not exists (select 1 from public.fact_comprobantes), null;
