-- ============================================================================
-- CHECKLIST POST-DEPLOY · 20260815100000 + 20260815110000
-- ============================================================================
-- Sólo lectura. Ejecutar DESPUÉS de aplicar las dos migraciones.
-- Una sola sentencia con union all: el editor de Supabase muestra únicamente
-- el resultado del último select.
--
-- Del C1 al C12 tienen que decir OK. El C13 y el C14 son informativos.
-- ============================================================================

select 1 as n, 'C1 columna tipo_ubicacion' as control,
       case when count(*) = 1 then 'OK presente' else 'FALLA ausente' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'objetivos' and column_name = 'tipo_ubicacion'

union all
select 2, 'C2 tabla objetivo_ubicaciones',
       case when to_regclass('public.objetivo_ubicaciones') is null
            then 'FALLA ausente' else 'OK presente' end

union all
select 3, 'C3 índice único de una sola vigencia abierta',
       case when exists (
              select 1 from pg_catalog.pg_indexes
              where schemaname = 'public' and indexname = 'uq_objetivo_ubicaciones_vigente')
            then 'OK presente' else 'FALLA ausente' end

union all
select 4, 'C4 EXCLUDE anti-solapamiento',
       case when exists (
              select 1 from pg_catalog.pg_constraint
              where conrelid = 'public.objetivo_ubicaciones'::regclass
                and conname = 'objetivo_ubicaciones_sin_solapamiento'
                and contype = 'x')
            then 'OK presente' else 'FALLA ausente' end

union all
select 5, 'C5 CHECK de coherencia de fechas',
       case when exists (
              select 1 from pg_catalog.pg_constraint
              where conrelid = 'public.objetivo_ubicaciones'::regclass
                and conname = 'objetivo_ubicaciones_vigencia_coherente')
            then 'OK presente' else 'FALLA ausente' end

union all
select 6, 'C6 EL CANDADO: authenticated NO puede escribir lat/lng/radio',
       case when not has_column_privilege('authenticated','public.objetivos','lat','UPDATE')
             and not has_column_privilege('authenticated','public.objetivos','lng','UPDATE')
             and not has_column_privilege('authenticated','public.objetivos','radio_metros','UPDATE')
            then 'OK bloqueado' else 'FALLA todavía puede escribir GPS directo' end

union all
select 7, 'C7 authenticated SÍ puede editar el resto del objetivo',
       case when has_column_privilege('authenticated','public.objetivos','nombre','UPDATE')
             and has_column_privilege('authenticated','public.objetivos','estado','UPDATE')
             and has_column_privilege('authenticated','public.objetivos','tipo_ubicacion','UPDATE')
            then 'OK' else 'FALLA se bloqueó de más' end

union all
select 8, 'C8 service_role conserva la llave maestra',
       case when has_column_privilege('service_role','public.objetivos','lat','UPDATE')
            then 'OK intacto' else 'ATENCION service_role perdió privilegios' end

union all
select 9, 'C9 RPC establecer_ubicacion_objetivo',
       coalesce(
         (select case when p.prosecdef then 'OK presente SECURITY DEFINER'
                      else 'FALLA sin security definer' end
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace nsp on nsp.oid = p.pronamespace
          where nsp.nspname = 'public' and p.proname = 'establecer_ubicacion_objetivo'),
         'FALLA ausente')

union all
select 10, 'C10 search_path fijado en la RPC',
       case when exists (
              select 1 from pg_catalog.pg_proc p
              join pg_catalog.pg_namespace nsp on nsp.oid = p.pronamespace
              where nsp.nspname = 'public' and p.proname = 'establecer_ubicacion_objetivo'
                and p.proconfig::text like '%search_path%')
            then 'OK' else 'FALLA sin search_path fijo' end

union all
select 11, 'C11 trigger de alta abre la primera vigencia',
       case when exists (
              select 1 from pg_catalog.pg_trigger
              where tgrelid = 'public.objetivos'::regclass
                and tgname = 'trg_objetivos_vigencia_alta'
                and not tgisinternal)
            then 'OK presente' else 'FALLA ausente' end

union all
select 12, 'C12 ninguna vigencia con datos incompletos',
       case when count(*) = 0 then 'OK 0'
            else 'FALLA ' || count(*) || ' vigencias incompletas' end
from public.objetivo_ubicaciones
where lat is null or lng is null or radio_metros is null or radio_metros <= 0

union all
select 13, 'C13 objetivos con vigencia abierta (informativo)',
       (select count(*)::text from public.objetivo_ubicaciones where vigente_hasta is null)

union all
select 14, 'C14 objetivos SIN vigencia por no tener GPS completo (informativo)',
       (select count(*)::text
        from public.objetivos o
        where not exists (
          select 1 from public.objetivo_ubicaciones u where u.objetivo_id = o.id))

order by n;
