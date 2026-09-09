-- ============================================================================
-- Verificación M6 — objetivos y novedades. Solo lectura.
-- Correr PRE antes (y GUARDAR la salida) y POST después. Cada sección es una
-- única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select 'politica' as tipo, tablename as tabla, policyname as detalle,
       cmd as comando, coalesce(roles::text, '') as roles,
       coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('objetivos', 'novedades')
union all
select 'grant', table_name, grantee, privilege_type, '', '', ''
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('objetivos', 'novedades')
   and grantee in ('anon', 'authenticated')
 order by 1, 2, 3;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'politicas laxas restantes' as control,
         count(*)::text as resultado, '0' as esperado
    from pg_policies
   where schemaname = 'public'
     and tablename in ('objetivos', 'novedades')
     and (qual = 'true' or (qual is null and with_check = 'true'))
  union all
  select 2, 'politicas nuevas de objetivos', count(*)::text, '4'
    from pg_policies
   where schemaname = 'public' and tablename = 'objetivos'
     and policyname in ('objetivos_select_usuario_activo', 'objetivos_insert_admin',
                        'objetivos_update_operador', 'objetivos_delete_admin')
  union all
  select 3, 'politicas nuevas de novedades', count(*)::text, '3'
    from pg_policies
   where schemaname = 'public' and tablename = 'novedades'
     and policyname in ('novedades_select_operador', 'novedades_insert_operador',
                        'novedades_update_operador')
  union all
  select 4, 'authenticated conserva DELETE sobre objetivos (borrado fisico admin)',
         has_table_privilege('authenticated', 'public.objetivos', 'DELETE')::text, 'true'
  union all
  select 5, 'authenticated sin DELETE sobre novedades',
         has_table_privilege('authenticated', 'public.novedades', 'DELETE')::text, 'false'
  union all
  select 6, 'authenticated sin TRUNCATE sobre objetivos',
         has_table_privilege('authenticated', 'public.objetivos', 'TRUNCATE')::text, 'false'
  union all
  select 7, 'helpers requeridos presentes (ia_es_admin, ia_es_operador, rondas_usuario_actual_id)',
         (
           (to_regprocedure('public.ia_es_admin()') is not null)::int
           + (to_regprocedure('public.ia_es_operador()') is not null)::int
           + (to_regprocedure('public.rondas_usuario_actual_id()') is not null)::int
         )::text, '3'
) v
order by orden;
