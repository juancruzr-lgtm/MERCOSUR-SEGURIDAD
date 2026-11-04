-- Chequeo PREVIO a 20261202120000_facturacion_grupos_factura. SÓLO LECTURA.
-- Una sola sentencia: "ok" debe ser true en todas las filas antes de aplicarla.
select 'las 4 migraciones de facturación ya están aplicadas' control,
       (select count(distinct name) from supabase_migrations.schema_migrations
         where name in ('20261201120000_facturacion_base', '20261201130000_facturacion_comprobantes_arca',
                        '20261201140000_facturacion_cuentas_corrientes', '20261201150000_facturacion_vencimientos_intereses')) = 4 ok,
       null::text detalle
union all
select 'la de grupos todavía no está registrada',
       not exists (select 1 from supabase_migrations.schema_migrations where name = '20261202120000_facturacion_grupos_factura'), null
union all
select 'no existe la columna grupo_factura',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fact_contrato_objetivos' and column_name = 'grupo_factura'), null
union all
select 'no existe la columna objetivos_incluidos',
       not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fact_prefacturas' and column_name = 'objetivos_incluidos'), null
union all
select 'no existe la función de grupos',
       to_regprocedure('public.fact_contrato_objetivo_grupo(uuid, text)') is null, null
union all
select 'ninguna prefactura emitida (nada fiscal en juego)',
       not exists (select 1 from public.fact_prefacturas where estado = 'emitida'),
       (select count(*)::text || ' prefacturas vivas' from public.fact_prefacturas where estado <> 'descartada');
