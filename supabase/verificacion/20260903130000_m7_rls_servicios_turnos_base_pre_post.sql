-- ============================================================================
-- Verificación M7 — servicios_objetivo y turnos_base. Solo lectura.
-- Correr PRE antes (y GUARDAR la salida) y POST después. Cada sección es una
-- única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select 'politica' as tipo, tablename as tabla, policyname as detalle,
       cmd as comando, coalesce(roles::text, '') as roles,
       coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('servicios_objetivo', 'turnos_base')
union all
select 'grant', table_name, grantee, privilege_type, '', '', ''
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('servicios_objetivo', 'turnos_base')
   and grantee in ('anon', 'authenticated')
 order by 1, 2, 3;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'politicas laxas restantes' as control,
         count(*)::text as resultado, '0' as esperado
    from pg_policies
   where schemaname = 'public'
     and tablename in ('servicios_objetivo', 'turnos_base')
     and (qual = 'true' or (qual is null and with_check = 'true'))
  union all
  select 2, 'politicas nuevas de servicios_objetivo', count(*)::text, '3'
    from pg_policies
   where schemaname = 'public' and tablename = 'servicios_objetivo'
     and policyname in ('servicios_objetivo_select_operador',
                        'servicios_objetivo_insert_admin',
                        'servicios_objetivo_update_admin')
  union all
  select 3, 'politicas nuevas de turnos_base', count(*)::text, '3'
    from pg_policies
   where schemaname = 'public' and tablename = 'turnos_base'
     and policyname in ('turnos_base_select_operador',
                        'turnos_base_insert_admin',
                        'turnos_base_update_admin')
  union all
  select 4, 'RLS habilitada en las dos tablas', count(*)::text, '2'
    from pg_tables
   where schemaname = 'public'
     and tablename in ('servicios_objetivo', 'turnos_base')
     and rowsecurity
  union all
  select 5, 'authenticated sin DELETE sobre servicios_objetivo',
         has_table_privilege('authenticated', 'public.servicios_objetivo', 'DELETE')::text, 'false'
  union all
  select 6, 'authenticated sin DELETE sobre turnos_base',
         has_table_privilege('authenticated', 'public.turnos_base', 'DELETE')::text, 'false'
) v
order by orden;
