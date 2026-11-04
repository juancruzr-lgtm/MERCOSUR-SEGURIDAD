-- Verificación POSTERIOR a 20261202120000_facturacion_grupos_factura. SÓLO LECTURA.
-- Una sola sentencia: "ok" debe ser true en todas las filas recién aplicada.
select 'migración registrada' control,
       exists (select 1 from supabase_migrations.schema_migrations where name = '20261202120000_facturacion_grupos_factura') ok,
       null::text detalle
union all
select 'grupo_factura existe y arranca vacía (no cambia ninguna agrupación)',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fact_contrato_objetivos' and column_name = 'grupo_factura')
       and not exists (select 1 from public.fact_contrato_objetivos where grupo_factura is not null),
       (select count(*)::text || ' vínculos' from public.fact_contrato_objetivos)
union all
select 'grupo_factura con control de largo y espacios',
       exists (select 1 from pg_constraint where conname = 'fact_contrato_objetivos_grupo_factura_check'), null
union all
select 'objetivos_incluidos existe y ninguna prefactura existente fue tocada',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fact_prefacturas' and column_name = 'objetivos_incluidos')
       and not exists (select 1 from public.fact_prefacturas where objetivos_incluidos is not null),
       (select count(*)::text || ' prefacturas' from public.fact_prefacturas)
union all
select 'función de grupos: SECURITY DEFINER con search_path fijo',
       exists (select 1 from pg_proc where oid = to_regprocedure('public.fact_contrato_objetivo_grupo(uuid, text)')
               and prosecdef and array_to_string(proconfig, ',') like '%search_path=public%'), null
union all
select 'función de grupos: anon NO la ejecuta, authenticated sí',
       not has_function_privilege('anon', 'public.fact_contrato_objetivo_grupo(uuid, text)', 'execute')
       and has_function_privilege('authenticated', 'public.fact_contrato_objetivo_grupo(uuid, text)', 'execute'), null
union all
select 'la función de grupos deja historial',
       (select prosrc from pg_proc where oid = to_regprocedure('public.fact_contrato_objetivo_grupo(uuid, text)')) like '%fact_registrar(%grupo_factura%', null
union all
select 'fact_prefactura_guardar guarda objetivos_incluidos y sigue cerrada a anon',
       (select prosrc from pg_proc where oid = to_regprocedure('public.fact_prefactura_guardar(uuid, jsonb, integer)')) like '%objetivos_incluidos%'
       and not has_function_privilege('anon', 'public.fact_prefactura_guardar(uuid, jsonb, integer)', 'execute'), null
union all
select 'la huella de aprobación no cambió (no depende de las columnas nuevas)',
       (select prosrc from pg_proc where oid = to_regprocedure('public.fact_prefactura_huella(public.fact_prefacturas)')) not like '%objetivos_incluidos%', null
union all
select 'las dos tablas siguen con RLS y sin escritura directa',
       (select bool_and(c.relrowsecurity and not has_table_privilege('authenticated', c.oid, 'UPDATE') and not has_table_privilege('anon', c.oid, 'SELECT'))
          from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('fact_contrato_objetivos', 'fact_prefacturas')), null;
