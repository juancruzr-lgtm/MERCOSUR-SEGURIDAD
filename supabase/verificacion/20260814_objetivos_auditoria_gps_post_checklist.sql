-- ============================================================================
-- CHECKLIST POST-DEPLOY · 20260814100000_objetivos_auditoria_gps
-- ============================================================================
-- Sólo lectura. Ejecutar DESPUÉS de aplicar la migración.
--
-- Es UNA sola sentencia con union all a propósito: el editor de Supabase
-- muestra únicamente el resultado del último select, así que varios selects
-- sueltos harían que se vean sólo los del final.
--
-- Todo tiene que decir OK.
-- ============================================================================

select 1 as n, 'C1 columnas ctx_* en objetivos' as control,
       case when count(*) = 2 then 'OK (2 de 2)' else 'FALLA (' || count(*) || ' de 2)' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'objetivos'
  and column_name in ('ctx_cambio_origen', 'ctx_cambio_firma')

union all
select 2, 'C2 CHECK objetivos_ctx_cambio_en_reposo',
       coalesce(
         (select case when c.convalidated then 'OK presente y validado'
                      else 'FALLA presente sin validar' end
          from pg_catalog.pg_constraint c
          where c.conrelid = 'public.objetivos'::regclass
            and c.conname  = 'objetivos_ctx_cambio_en_reposo'),
         'FALLA ausente')

union all
select 3, 'C3 objetivos con contexto persistido (debe ser 0)',
       case when count(*) = 0 then 'OK 0' else 'FALLA ' || count(*) end
from public.objetivos
where ctx_cambio_origen is not null or ctx_cambio_firma is not null

union all
select 4, 'C4 tabla objetivos_auditoria',
       case when to_regclass('public.objetivos_auditoria') is null
            then 'FALLA ausente' else 'OK presente' end

union all
select 5, 'C5 RLS en la auditoría',
       case when (select c.relrowsecurity from pg_catalog.pg_class c
                  where c.oid = 'public.objetivos_auditoria'::regclass)
            then 'OK habilitada' else 'FALLA sin RLS' end

union all
select 6, 'C6 policies en la auditoría (debe haber 1, de SELECT)',
       case when count(*) = 1 then 'OK 1' else 'FALLA ' || count(*) end
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'objetivos_auditoria'

union all
select 7, 'C7 authenticated sólo puede leer la auditoría',
       case when has_table_privilege('authenticated','public.objetivos_auditoria','SELECT')
             and not has_table_privilege('authenticated','public.objetivos_auditoria','INSERT')
             and not has_table_privilege('authenticated','public.objetivos_auditoria','UPDATE')
             and not has_table_privilege('authenticated','public.objetivos_auditoria','DELETE')
            then 'OK sólo SELECT' else 'FALLA puede escribir o no puede leer' end

union all
select 8, 'C8 anon sin acceso a la auditoría',
       case when has_table_privilege('anon','public.objetivos_auditoria','SELECT')
            then 'FALLA anon puede leer' else 'OK sin acceso' end

union all
select 9, 'C9 función objetivos_auditar_cambio',
       coalesce(
         (select case when p.prosecdef then 'OK presente SECURITY DEFINER'
                      else 'FALLA sin security definer' end
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace nsp on nsp.oid = p.pronamespace
          where nsp.nspname = 'public' and p.proname = 'objetivos_auditar_cambio'),
         'FALLA ausente')

union all
select 10, 'C10 la auditoría es el último BEFORE UPDATE de objetivos',
       coalesce(
         (select case when max(t.tgname) = 'trg_objetivos_zz_auditoria'
                      then 'OK (' || string_agg(t.tgname, ' -> ' order by t.tgname) || ')'
                      else 'FALLA (' || string_agg(t.tgname, ' -> ' order by t.tgname) || ')' end
          from pg_catalog.pg_trigger t
          where t.tgrelid = 'public.objetivos'::regclass
            and not t.tgisinternal
            and (t.tgtype & 2) <> 0
            and (t.tgtype & 16) <> 0),
         'FALLA no hay trigger')

union all
select 11, 'C11 filas de auditoría registradas hasta ahora (informativo)',
       count(*)::text
from public.objetivos_auditoria

order by n;
