-- Verificación posterior de 20261208100000_facturacion_conceptos_fijos.
-- Sólo lectura, una sola sentencia. Todas las filas deben dar ok = true.
select 'existe fact_conceptos_fijos con RLS' as control,
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.fact_conceptos_fijos')), false) as ok
union all select 'authenticated sólo lee (sin INSERT/UPDATE/DELETE); anon nada',
       has_table_privilege('authenticated', 'public.fact_conceptos_fijos', 'select')
       and not has_table_privilege('authenticated', 'public.fact_conceptos_fijos', 'insert')
       and not has_table_privilege('authenticated', 'public.fact_conceptos_fijos', 'update')
       and not has_table_privilege('authenticated', 'public.fact_conceptos_fijos', 'delete')
       and not has_table_privilege('anon', 'public.fact_conceptos_fijos', 'select')
union all select 'política de lectura con facturacion_puede_actual()',
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fact_conceptos_fijos'
                and policyname = 'fact_conceptos_fijos_lectura' and qual ilike '%facturacion_puede_actual%')
union all select 'trigger de no solape instalado',
       exists (select 1 from pg_trigger where tgrelid = to_regclass('public.fact_conceptos_fijos') and tgname = 'fact_conceptos_fijos_sin_solape')
union all select 'las dos RPC existen, pasan por facturacion_gate y son SECURITY DEFINER',
       (select count(*) = 2 and bool_and(prosecdef and prosrc like '%facturacion_gate()%') from pg_proc
         where pronamespace = 'public'::regnamespace and proname in ('fact_concepto_fijo_agregar', 'fact_concepto_fijo_cerrar'))
union all select 'anon no ejecuta las RPC',
       not has_function_privilege('anon', 'public.fact_concepto_fijo_agregar(uuid,uuid,text,text,numeric,text,numeric,date,boolean,text)', 'execute')
       and not has_function_privilege('anon', 'public.fact_concepto_fijo_cerrar(uuid,date,text)', 'execute')
union all select 'recién aplicada: sin conceptos cargados (no se cargó nada sin autorización)',
       (select count(*) = 0 from public.fact_conceptos_fijos);
