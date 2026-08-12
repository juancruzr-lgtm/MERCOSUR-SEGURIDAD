-- ============================================================================
-- CHECKLIST POST-DEPLOY · 20260814200000_objetivo_diagnostico_gps
-- ============================================================================
-- Sólo lectura. Ejecutar DESPUÉS de aplicar la migración.
-- Una sola sentencia con union all: el editor de Supabase muestra únicamente
-- el resultado del último select.
-- ============================================================================

select 1 as n, 'C1 tabla objetivo_diagnosticos_gps' as control,
       case when to_regclass('public.objetivo_diagnosticos_gps') is null
            then 'FALLA ausente' else 'OK presente' end as resultado

union all
select 2, 'C2 RLS en la tabla de diagnósticos',
       case when (select c.relrowsecurity from pg_catalog.pg_class c
                  where c.oid = 'public.objetivo_diagnosticos_gps'::regclass)
            then 'OK habilitada' else 'FALLA sin RLS' end

union all
select 3, 'C3 authenticated sólo puede leer',
       case when has_table_privilege('authenticated','public.objetivo_diagnosticos_gps','SELECT')
             and not has_table_privilege('authenticated','public.objetivo_diagnosticos_gps','INSERT')
             and not has_table_privilege('authenticated','public.objetivo_diagnosticos_gps','UPDATE')
             and not has_table_privilege('authenticated','public.objetivo_diagnosticos_gps','DELETE')
            then 'OK sólo SELECT' else 'FALLA puede escribir o no puede leer' end

union all
select 4, 'C4 anon sin acceso',
       case when has_table_privilege('anon','public.objetivo_diagnosticos_gps','SELECT')
            then 'FALLA anon puede leer' else 'OK sin acceso' end

union all
select 5, 'C5 función diagnosticar_gps_objetivo',
       coalesce(
         (select case when p.prosecdef then 'OK presente SECURITY DEFINER'
                      else 'FALLA sin security definer' end
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace nsp on nsp.oid = p.pronamespace
          where nsp.nspname = 'public' and p.proname = 'diagnosticar_gps_objetivo'),
         'FALLA ausente')

union all
select 6, 'C6 execute: authenticated sí, anon no',
       case when to_regprocedure('public.diagnosticar_gps_objetivo(uuid,integer)') is null then 'FALLA función ausente'
            when has_function_privilege('authenticated','public.diagnosticar_gps_objetivo(uuid,integer)','EXECUTE')
             and not has_function_privilege('anon','public.diagnosticar_gps_objetivo(uuid,integer)','EXECUTE')
            then 'OK' else 'FALLA grants incorrectos' end

union all
select 7, 'C7 la auditoría de objetivos sigue en pie (dependencia)',
       case when to_regclass('public.objetivos_auditoria') is null
            then 'FALLA falta objetivos_auditoria' else 'OK presente' end

union all
select 8, 'C8 columnas de contexto en objetivos (dependencia)',
       case when (select count(*) from information_schema.columns
                  where table_schema='public' and table_name='objetivos'
                    and column_name in ('ctx_cambio_origen','ctx_cambio_firma')) = 2
            then 'OK 2 de 2' else 'FALLA faltan columnas ctx_*' end

union all
select 9, 'C9 diagnósticos generados hasta ahora (informativo)',
       (select count(*)::text from public.objetivo_diagnosticos_gps)

order by n;
