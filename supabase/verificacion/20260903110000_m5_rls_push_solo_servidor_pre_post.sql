-- ============================================================================
-- Verificación M5 — tablas de push. Solo lectura.
-- Correr PRE antes (y GUARDAR la salida) y POST después. Cada sección es una
-- única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select 'politica' as tipo, tablename as tabla, policyname as detalle,
       cmd as comando, coalesce(roles::text, '') as roles,
       coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('push_subscriptions', 'notificaciones_enviadas')
union all
select 'grant', table_name, grantee, privilege_type, '', '', ''
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('push_subscriptions', 'notificaciones_enviadas')
   and grantee in ('anon', 'authenticated')
 order by 1, 2, 3;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'politicas laxas restantes' as control,
         count(*)::text as resultado, '0' as esperado
    from pg_policies
   where schemaname = 'public'
     and tablename in ('push_subscriptions', 'notificaciones_enviadas')
     and (qual = 'true' or (qual is null and with_check = 'true'))
  union all
  select 2, 'privilegios restantes de anon/authenticated', count(*)::text, '0'
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('push_subscriptions', 'notificaciones_enviadas')
     and grantee in ('anon', 'authenticated')
  union all
  select 3, 'service_role conserva SELECT sobre push_subscriptions',
         has_table_privilege('service_role', 'public.push_subscriptions', 'SELECT')::text,
         'true'
) v
order by orden;
