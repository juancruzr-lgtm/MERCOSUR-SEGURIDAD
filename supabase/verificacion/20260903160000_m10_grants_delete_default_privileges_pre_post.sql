-- ============================================================================
-- Verificación M10 — privilegios de authenticated en todo public. Solo lectura.
-- Correr PRE antes (y GUARDAR la salida: es el mapa exacto tabla-privilegio
-- para un rollback fino) y POST después. Cada sección es una única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select 'grant_tabla' as tipo, table_name as objeto, privilege_type as detalle
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee = 'authenticated'
   and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
union all
select 'default_acl', pg_get_userbyid(d.defaclrole), array_to_string(d.defaclacl, ' | ')
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public' and d.defaclobjtype = 'r'
 order by 1, 2, 3;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden,
         'tablas de public donde authenticated conserva DELETE' as control,
         coalesce(string_agg(table_name, ', ' order by table_name), '(ninguna)') as resultado,
         'nocturnidad_empleado_objetivo, objetivos, supervisiones, supervisor_zonas' as esperado
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and privilege_type = 'DELETE'
  union all
  select 2, 'grants de TRUNCATE/REFERENCES/TRIGGER restantes', count(*)::text, '0'
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  union all
  select 3, 'default ACL de public para tablas (no debe incluir D/x/t para authenticated)',
         coalesce(string_agg(pg_get_userbyid(d.defaclrole) || ': ' || array_to_string(d.defaclacl, ' | '), ' ;; '), '(sin entradas)'),
         'authenticated sin arwdDxt completo; sin D, x, t'
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public' and d.defaclobjtype = 'r'
  union all
  select 4, 'authenticated conserva SELECT sobre turnos (control de no-rotura)',
         has_table_privilege('authenticated', 'public.turnos', 'SELECT')::text, 'true'
) v
order by orden;
