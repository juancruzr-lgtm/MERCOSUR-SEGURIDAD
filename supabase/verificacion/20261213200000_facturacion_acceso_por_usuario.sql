-- Verificación post-migración 20261213200000_facturacion_acceso_por_usuario
-- Sólo lectura. Cada fila debe dar ok = true.

select 'columna acceso_facturacion' as control,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name = 'acceso_facturacion') as ok;

select 'gate completo exige la marca' as control,
       pg_get_functiondef('public.facturacion_puede_actual()'::regprocedure) like '%acceso_facturacion = true%' as ok;

select 'trigger de protección' as control,
       exists (select 1 from pg_trigger where tgname = 'usuarios_acceso_facturacion_guard' and not tgisinternal) as ok;

select 'políticas de consulta' as control,
       (select count(*) from pg_policies where schemaname = 'public' and policyname like 'fact_%_lectura_consulta') = 4 as ok;

select 'sólo administración tiene la marca' as control,
       not exists (select 1 from public.usuarios where acceso_facturacion and puesto_organizacional is distinct from 'administracion') as ok;

select 'permisos' as control,
       has_function_privilege('authenticated', 'public.facturacion_ver_comprobantes_actual()', 'execute')
       and not has_function_privilege('anon', 'public.facturacion_ver_comprobantes_actual()', 'execute') as ok;
