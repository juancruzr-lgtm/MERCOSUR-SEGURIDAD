-- ============================================================================
-- Verificación M9 — usuarios. Solo lectura.
-- Correr PRE antes (y GUARDAR la salida: las políticas del panel no están
-- versionadas y esto es su único registro) y POST después. Cada sección es
-- una única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select 'politica' as tipo, policyname as detalle, cmd as comando,
       coalesce(roles::text, '') as roles,
       coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'usuarios'
union all
select 'grant', grantee, privilege_type, '', '', ''
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'usuarios'
   and grantee in ('anon', 'authenticated')
union all
select 'funcion_is_admin',
       coalesce(to_regprocedure('public.is_admin()')::text, 'no existe'),
       '', '', '', ''
 order by 1, 2, 3;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'politicas laxas restantes en usuarios' as control,
         count(*)::text as resultado, '0' as esperado
    from pg_policies
   where schemaname = 'public' and tablename = 'usuarios'
     and (qual = 'true' or (qual is null and with_check = 'true'))
  union all
  select 2, 'politicas del panel eliminadas (usuarios_select/update/delete)',
         count(*)::text, '0'
    from pg_policies
   where schemaname = 'public' and tablename = 'usuarios'
     and policyname in ('usuarios_select', 'usuarios_update', 'usuarios_delete')
  union all
  select 3, 'politicas nuevas presentes', count(*)::text, '5'
    from pg_policies
   where schemaname = 'public' and tablename = 'usuarios'
     and policyname in ('usuarios_admin_todo', 'usuarios_operador_select',
                        'usuarios_supervisor_update_guardias',
                        'usuarios_propio_select', 'usuarios_vincular_auth')
  union all
  select 4, 'trigger de campos criticos activo', count(*)::text, '1'
    from pg_trigger
   where tgname = 'usuarios_proteger_campos_criticos'
     and tgrelid = 'public.usuarios'::regclass
     and not tgisinternal
  union all
  select 5, 'authenticated sin DELETE sobre usuarios',
         has_table_privilege('authenticated', 'public.usuarios', 'DELETE')::text, 'false'
  union all
  select 6, 'authenticated conserva SELECT/INSERT/UPDATE (los filtra RLS)',
         (
           has_table_privilege('authenticated', 'public.usuarios', 'SELECT')::int
           + has_table_privilege('authenticated', 'public.usuarios', 'INSERT')::int
           + has_table_privilege('authenticated', 'public.usuarios', 'UPDATE')::int
         )::text, '3'
) v
order by orden;
