-- ============================================================================
-- Verificación M8 — supervisores_guardia, supervisor_guardia_reglas,
-- solicitudes_admin, supervisor_intervenciones. Solo lectura.
-- Correr PRE antes (y GUARDAR la salida) y POST después. Cada sección es una
-- única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select 'politica' as tipo, tablename as tabla, policyname as detalle,
       cmd as comando, coalesce(roles::text, '') as roles,
       coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('supervisores_guardia', 'supervisor_guardia_reglas',
                     'solicitudes_admin', 'supervisor_intervenciones')
union all
select 'grant', table_name, grantee, privilege_type, '', '', ''
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('supervisores_guardia', 'supervisor_guardia_reglas',
                      'solicitudes_admin', 'supervisor_intervenciones')
   and grantee in ('anon', 'authenticated')
 order by 1, 2, 3;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'politicas laxas restantes en las 4 tablas' as control,
         count(*)::text as resultado, '0' as esperado
    from pg_policies
   where schemaname = 'public'
     and tablename in ('supervisores_guardia', 'supervisor_guardia_reglas',
                       'solicitudes_admin', 'supervisor_intervenciones')
     and (qual = 'true' or (qual is null and with_check = 'true'))
  union all
  select 2, 'politicas nuevas de supervisores_guardia', count(*)::text, '3'
    from pg_policies
   where schemaname = 'public' and tablename = 'supervisores_guardia'
     and policyname in ('supervisores_guardia_select_operador',
                        'supervisores_guardia_insert_admin',
                        'supervisores_guardia_update_admin')
  union all
  select 3, 'politicas nuevas de supervisor_guardia_reglas', count(*)::text, '3'
    from pg_policies
   where schemaname = 'public' and tablename = 'supervisor_guardia_reglas'
     and policyname in ('supervisor_guardia_reglas_select_admin',
                        'supervisor_guardia_reglas_insert_admin',
                        'supervisor_guardia_reglas_update_admin')
  union all
  select 4, 'politicas nuevas de solicitudes_admin', count(*)::text, '3'
    from pg_policies
   where schemaname = 'public' and tablename = 'solicitudes_admin'
     and policyname in ('solicitudes_admin_select_propio_o_admin',
                        'solicitudes_admin_insert_propio',
                        'solicitudes_admin_update_admin')
  union all
  select 5, 'supervisor_intervenciones conserva sus politicas por alcance', count(*)::text, '2'
    from pg_policies
   where schemaname = 'public' and tablename = 'supervisor_intervenciones'
     and policyname in ('Revision operativa lectura por alcance',
                        'Revision operativa insercion autenticada')
  union all
  select 6, 'DELETE de authenticated en las 4 tablas', count(*)::text, '0'
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('supervisores_guardia', 'supervisor_guardia_reglas',
                        'solicitudes_admin', 'supervisor_intervenciones')
     and grantee = 'authenticated'
     and privilege_type in ('DELETE', 'TRUNCATE')
) v
order by orden;
