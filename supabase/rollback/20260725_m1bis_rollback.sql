-- ============================================================================
-- ROLLBACK de M1-bis — Restituir los privilegios por defecto para `anon`
-- ============================================================================
--
-- Revierte: supabase/migrations/20260725_m1bis_default_privileges_anon.sql
--
-- ATENCIÓN: este archivo restituye una configuración INSEGURA. Ejecutarlo hace
-- que toda tabla, secuencia y función nueva del esquema `public` vuelva a
-- nacer con acceso anónimo completo.
--
-- Restituye exactamente el estado observado en producción el 2026-07-25:
--   propietario     objeto      ACL para anon
--   postgres        tabla       arwdDxtm
--   postgres        secuencia   rwU
--   postgres        función     X
--   supabase_admin  tabla       arwdDxtm
--   supabase_admin  secuencia   rwU
--   supabase_admin  función     X
--
-- Los privilegios se conceden con el conjunto `ALL`, que en cada tipo de
-- objeto equivale a las letras de arriba: `arwdDxtm` para tablas, `rwU` para
-- secuencias y `X` para funciones. La restitución es idéntica al estado previo.
--
-- Ejecutar SÓLO el bloque correspondiente al bloque de M1-bis que se haya
-- aplicado. Si el BLOQUE 2 de M1-bis falló por permisos, no ejecutar el
-- BLOQUE 2 de este archivo.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — Rol `postgres`
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter default privileges for role postgres in schema public
  grant all on tables to anon;

alter default privileges for role postgres in schema public
  grant all on sequences to anon;

alter default privileges for role postgres in schema public
  grant all on functions to anon;

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — Rol `supabase_admin`  (sólo si el BLOQUE 2 de M1-bis se aplicó)
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter default privileges for role supabase_admin in schema public
  grant all on tables to anon;

alter default privileges for role supabase_admin in schema public
  grant all on sequences to anon;

alter default privileges for role supabase_admin in schema public
  grant all on functions to anon;

commit;


-- ============================================================================
-- Verificación del rollback
-- ============================================================================
-- Debe volver a mostrar las entradas con `anon=` para el esquema public:
--
-- select pg_get_userbyid(d.defaclrole) as propietario,
--        d.defaclobjtype, d.defaclacl::text
--   from pg_default_acl d
--   join pg_namespace n on n.oid = d.defaclnamespace
--  where n.nspname = 'public';
-- ============================================================================
