-- ═══════════════════════════════════════════════════════════════════════════
-- Consultas que generan tests/db/schema/*.sql desde el esquema VIVO de producción.
--
-- SÓLO LECTURA: cada bloque va entre `begin transaction read only;` y `rollback;`.
-- Leen únicamente el catálogo (pg_class, pg_attribute, pg_policy, pg_proc,
-- pg_trigger, ACLs). NO leen filas de ninguna tabla: el snapshot no lleva datos.
--
-- Cada consulta devuelve UNA columna de texto (`ddl`) que se guarda tal cual en
-- el archivo indicado. Ver scripts/db-snapshot/README.md para el procedimiento.
--
-- Parámetros (editarlos acá si cambia el alcance del snapshot):
--   TABLAS        tablas con columnas + constraints + RLS + políticas + grants.
--   DEPENDENCIAS  tablas que sólo leen las funciones (columnas y constraints; sin
--                 políticas ni grants: nadie las consulta directo en las pruebas).
--   FUNCIONES     semilla de funciones; se agregan las que usan las políticas de
--                 TABLAS (pg_depend) y, por cierre, las que esas funciones llaman.
--   TRIGGERS      triggers a reproducir (los demás se omiten; ver README).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) tests/db/schema/10-tablas.sql ───────────────────────────────────────
begin transaction read only;
with
tablas(nombre, completa) as (values
  ('usuarios', true), ('zonas_operativas', true), ('supervisor_zonas', true), ('objetivos', true),
  ('puestos', true), ('turnos', true), ('turnos_auditoria', true), ('registros_asistencia', true),
  ('registros_asistencia_auditoria', true), ('asistencia_excepciones_autorizadas', true),
  ('supervisiones', true), ('supervision_respuestas', true), ('supervision_fotos', true),
  ('app_config', true), ('liquidacion_auditoria', true), ('gerencia_delegaciones', true),
  ('evidencias', false), ('ronda_ejecuciones', false)),
rel as (
  select c.oid, c.relname, t.completa, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace join tablas t on t.nombre = c.relname
  where n.nspname = 'public' and c.relkind = 'r'),
tipos as (  -- enums usados por las columnas
  select distinct 'create type ' || format_type(ty.oid, null) || ' as enum (' ||
    (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid = ty.oid) || ');' ddl
  from rel join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
  join pg_type ty on ty.oid = coalesce(nullif((select typelem from pg_type x where x.oid = a.atttypid and x.typcategory = 'A'), 0), a.atttypid)
  where ty.typtype = 'e'),
secuencias as (
  select distinct 'create sequence if not exists ' || m[1] || ';' ddl
  from rel join pg_attrdef d on d.adrelid = rel.oid,
  lateral regexp_matches(pg_get_expr(d.adbin, d.adrelid), 'nextval\(''([^'']+)''', 'g') m),
cuerpo as (
  select rel.relname,
    'create table public.' || quote_ident(rel.relname) || ' (' || E'\n' ||
    string_agg('  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod) ||
      case when a.attidentity in ('a', 'd') then ' generated ' || case a.attidentity when 'a' then 'always' else 'by default' end || ' as identity' else '' end ||
      case when a.attgenerated = 's' then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored'
           when d.adbin is not null then ' default ' || pg_get_expr(d.adbin, d.adrelid) else '' end ||
      case when a.attnotnull then ' not null' else '' end, E',\n' order by a.attnum) || E'\n);' ddl
  from rel join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = rel.oid and d.adnum = a.attnum
  group by rel.relname),
restricciones as (  -- PK, UNIQUE, CHECK (las FK van aparte, sólo entre tablas del snapshot)
  select rel.relname, string_agg('alter table public.' || quote_ident(rel.relname) || ' add constraint ' || quote_ident(k.conname) || ' ' || pg_get_constraintdef(k.oid) || ';', E'\n' order by k.contype desc, k.conname) ddl
  from rel join pg_constraint k on k.conrelid = rel.oid where k.contype in ('p', 'u', 'c') group by rel.relname),
indices_unicos as (  -- índices únicos que no respaldan una constraint (ON CONFLICT los necesita)
  select rel.relname, string_agg(pg_get_indexdef(i.indexrelid) || ';', E'\n' order by i.indexrelid::regclass::text) ddl
  from rel join pg_index i on i.indrelid = rel.oid
  where i.indisunique and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.conrelid = i.indrelid and k.contype in ('p', 'u', 'x'))
  group by rel.relname),
fks as (
  select string_agg('alter table public.' || quote_ident(rel.relname) || ' add constraint ' || quote_ident(k.conname) || ' ' || pg_get_constraintdef(k.oid) || ';', E'\n' order by rel.relname, k.conname) ddl
  from rel join pg_constraint k on k.conrelid = rel.oid
  where k.contype = 'f' and k.confrelid in (select oid from rel)),
rls as (
  select string_agg('alter table public.' || quote_ident(relname) || ' enable row level security;' ||
    case when relforcerowsecurity then E'\nalter table public.' || quote_ident(relname) || ' force row level security;' else '' end, E'\n' order by relname) ddl
  from rel where completa and relrowsecurity)
select concat_ws(E'\n\n',
  '-- Tablas (columnas, defaults, PK/UNIQUE/CHECK, FK internas, RLS). Generado con scripts/db-snapshot/consultas.sql (1).',
  (select string_agg(ddl, E'\n' order by ddl) from tipos),
  (select string_agg(ddl, E'\n' order by ddl) from secuencias),
  (select string_agg(c.ddl || coalesce(E'\n' || r.ddl, '') || coalesce(E'\n' || u.ddl, ''), E'\n\n' order by c.relname)
     from cuerpo c left join restricciones r using (relname) left join indices_unicos u using (relname)),
  '-- FK entre tablas del snapshot (las que apuntan afuera, p. ej. auth.users, se omiten)',
  (select ddl from fks),
  (select ddl from rls)) ddl;
rollback;

-- ── 2) tests/db/schema/20-funciones.sql ─────────────────────────────────────
begin transaction read only;
with recursive
tablas(nombre) as (values ('usuarios'), ('zonas_operativas'), ('supervisor_zonas'), ('objetivos'), ('puestos'), ('turnos'),
  ('turnos_auditoria'), ('registros_asistencia'), ('registros_asistencia_auditoria'), ('asistencia_excepciones_autorizadas'),
  ('supervisiones'), ('supervision_respuestas'), ('supervision_fotos'), ('app_config'), ('liquidacion_auditoria'), ('gerencia_delegaciones')),
semilla_nombres(nombre) as (values ('es_operador_actual'), ('puede_gestionar_personal_actual'), ('puede_gestionar_usuarios_roles_actual'),
  ('puede_gestionar_roles_normales_actual'), ('puede_configurar_sistema_actual'), ('puede_liquidar_actual'), ('es_gerencia_actual'),
  ('alcance_operativo_de'), ('alcanza_turno_actual'), ('actor_activo_actual'), ('_registro_liquidable_validar'),
  ('registros_asistencia_validar_liquidable'), ('usuarios_proteger_campos_criticos'), ('usuarios_guarda_acceso_bloqueado'),
  ('usuarios_acceso_facturacion_guard'), ('update_updated_at')),
pub as (select p.oid, p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
semilla as (
  select d.refobjid oid from pg_depend d join pg_policy pol on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
  join pg_class c on c.oid = pol.polrelid join pub on pub.oid = d.refobjid
  where c.relname in (select nombre from tablas) and d.refclassid = 'pg_proc'::regclass
  union select oid from pub where proname in (select nombre from semilla_nombres)),
cierre(oid) as (
  select oid from semilla
  union select q.oid from cierre c join pub p on p.oid = c.oid join pub q on p.prosrc ~ ('\m' || q.proname || '\s*\(')),
acl as (
  select p.oid, x.privilege_type, case when x.grantee = 0 then 'public' else r.rolname end grantee
  from cierre c join pg_proc p on p.oid = c.oid
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
  left join pg_roles r on r.oid = x.grantee
  where x.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role'))
select '-- Funciones (cuerpo real con pg_get_functiondef) y su ACL. Generado con scripts/db-snapshot/consultas.sql (2).' || E'\n\n' ||
  string_agg(pg_get_functiondef(p.oid) || E';\n' ||
    'revoke all on function public.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ') from public, anon, authenticated, service_role;' ||
    coalesce(E'\n' || (select string_agg('grant execute on function public.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ') to ' || a.grantee || ';', E'\n' order by a.grantee)
                       from acl a where a.oid = p.oid), ''),
    E'\n\n' order by p.proname) ddl
from cierre c join pg_proc p on p.oid = c.oid;
rollback;

-- ── 3) tests/db/schema/30-politicas-grants-triggers.sql ─────────────────────
begin transaction read only;
with
tablas(nombre) as (values ('usuarios'), ('zonas_operativas'), ('supervisor_zonas'), ('objetivos'), ('puestos'), ('turnos'),
  ('turnos_auditoria'), ('registros_asistencia'), ('registros_asistencia_auditoria'), ('asistencia_excepciones_autorizadas'),
  ('supervisiones'), ('supervision_respuestas'), ('supervision_fotos'), ('app_config'), ('liquidacion_auditoria'), ('gerencia_delegaciones')),
triggers(nombre) as (values ('usuarios_proteger_campos_criticos'), ('trg_usuarios_guarda_acceso'), ('usuarios_acceso_facturacion_guard'),
  ('registros_asistencia_validar_liquidable'), ('turnos_updated_at')),
rel as (select c.oid, c.relname, c.relacl, c.relowner from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in (select nombre from tablas)),
politicas as (
  select string_agg('create policy ' || quote_ident(p.polname) || ' on public.' || quote_ident(rel.relname) ||
    ' as ' || case when p.polpermissive then 'permissive' else 'restrictive' end ||
    ' for ' || case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end ||
    ' to ' || coalesce((select string_agg(case when r = 0 then 'public' else quote_ident(r::regrole::text) end, ', ') from unnest(p.polroles) r), 'public') ||
    coalesce(E'\n  using (' || pg_get_expr(p.polqual, p.polrelid) || ')', '') ||
    coalesce(E'\n  with check (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')', '') || ';', E'\n' order by rel.relname, p.polname) ddl
  from rel join pg_policy p on p.polrelid = rel.oid),
tabla_acl as (
  select rel.relname, x.privilege_type, case when x.grantee = 0 then 'public' else r.rolname end grantee
  from rel cross join lateral aclexplode(coalesce(rel.relacl, acldefault('r', rel.relowner))) x
  left join pg_roles r on r.oid = x.grantee
  where x.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role')),
columna_acl as (
  select rel.relname, a.attname, x.privilege_type, case when x.grantee = 0 then 'public' else r.rolname end grantee
  from rel join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  cross join lateral aclexplode(a.attacl) x left join pg_roles r on r.oid = x.grantee
  where x.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role')),
grants as (
  select string_agg(l, E'\n' order by orden, l) ddl from (
    select 0 orden, 'revoke all on table public.' || quote_ident(relname) || ' from public, anon, authenticated, service_role;' l from rel
    union all
    select 1, 'grant ' || string_agg(lower(privilege_type), ', ' order by privilege_type) || ' on table public.' || quote_ident(relname) || ' to ' || grantee || ';'
    from tabla_acl group by relname, grantee
    union all
    select 2, 'grant ' || lower(privilege_type) || ' (' || string_agg(quote_ident(attname), ', ' order by attname) || ') on table public.' || quote_ident(relname) || ' to ' || grantee || ';'
    from columna_acl group by relname, privilege_type, grantee) g),
trigs as (
  select string_agg(pg_get_triggerdef(t.oid) || ';', E'\n' order by t.tgname) ddl
  from rel join pg_trigger t on t.tgrelid = rel.oid and not t.tgisinternal where t.tgname in (select nombre from triggers))
select concat_ws(E'\n\n',
  '-- Políticas (pg_policy), grants de tabla y columna para anon/authenticated/service_role y triggers. Generado con scripts/db-snapshot/consultas.sql (3).',
  '-- Políticas', (select ddl from politicas),
  '-- Grants', (select ddl from grants),
  '-- Triggers', (select ddl from trigs)) ddl;
rollback;
