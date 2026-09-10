-- ============================================================================
-- VERIFICACIÓN PRE/POST · LIQ EXPORTACIÓN ATÓMICA (20260910130000)
-- ============================================================================
-- Una sola sentencia (union all): el editor de Supabase sólo muestra el último
-- SELECT. Correr ANTES (PRE) y DESPUÉS (POST) de aplicar la migración.
--   PRE : la función nueva NO existe; las 3 RPC viejas SÍ.
--   POST: la función nueva existe y es ejecutable por authenticated; las 3 RPC
--         viejas siguen existiendo (no se tocaron).
-- ============================================================================

select 'fn_nueva_existe' as chequeo,
       (to_regprocedure('public.exportar_liquidacion_periodo(uuid,jsonb,jsonb)') is not null)::text as valor,
       'POST=true / PRE=false' as esperado
union all
select 'fn_nueva_security_definer',
       coalesce((select p.prosecdef::text
                 from pg_proc p
                 where p.oid = to_regprocedure('public.exportar_liquidacion_periodo(uuid,jsonb,jsonb)')), 'n/a'),
       'POST=true'
union all
select 'fn_nueva_grant_authenticated',
       has_function_privilege('authenticated',
         'public.exportar_liquidacion_periodo(uuid,jsonb,jsonb)', 'execute')::text,
       'POST=true'
union all
select 'fn_nueva_sin_grant_anon',
       (not coalesce(has_function_privilege('anon',
         'public.exportar_liquidacion_periodo(uuid,jsonb,jsonb)', 'execute'), false))::text,
       'POST=true'
union all
select 'vieja_consolidar_periodo_intacta',
       (to_regprocedure('public.consolidar_periodo(uuid,jsonb)') is not null)::text,
       'siempre true'
union all
select 'vieja_registrar_enviado_intacta',
       (to_regprocedure('public.registrar_enviado_visual(uuid,jsonb)') is not null)::text,
       'siempre true'
union all
select 'vieja_marcar_exportada_intacta',
       (to_regprocedure('public.marcar_exportada_visual(uuid)') is not null)::text,
       'siempre true';
