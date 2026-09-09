-- ============================================================================
-- M1-bis — Impedir que el acceso anónimo reaparezca en objetos nuevos
-- ============================================================================
--
-- MOTIVO
-- `pg_default_acl` en producción (2026-07-25) contiene entradas ALTER DEFAULT
-- PRIVILEGES que conceden a `anon` sobre cada objeto nuevo del esquema public:
--
--   propietario     objeto      ACL para anon
--   postgres        tabla       arwdDxtm   (todos los privilegios)
--   postgres        secuencia   rwU
--   postgres        función     X
--   supabase_admin  tabla       arwdDxtm
--   supabase_admin  secuencia   rwU
--   supabase_admin  función     X
--
-- Sin esta migración, M1 protege las tablas de hoy y deja desprotegidas las de
-- mañana: la primera tabla del Legajo Vivo del Objetivo nacería con acceso
-- anónimo total, y lo mismo cualquier tabla futura de contactos, documentación
-- o cámaras.
--
-- DECISIÓN DE FONDO
-- Esta configuración es la de fábrica de Supabase, no una anomalía de este
-- proyecto: el modelo estándar asume que RLS es la única puerta. Cambiarlo es
-- una decisión deliberada de defensa en profundidad. Su costo práctico acá es
-- nulo, porque el sistema no tiene ni un solo flujo anónimo (verificado sobre
-- el repositorio en f86a9cf2). Su consecuencia permanente: toda tabla futura
-- que necesitara acceso anónimo deberá concederlo de forma explícita.
--
-- QUÉ NO TOCA
--   * `authenticated`  : conserva el privilegio por defecto. Revocarlo obligaría
--                        a un GRANT explícito por cada tabla nueva y multiplica
--                        el riesgo de error humano.
--   * `service_role`   : intacto.
--   * Esquemas `graphql`, `graphql_public`, `realtime`, `auth`, `extensions`:
--                        internos de Supabase, no se tocan.
--   * Esquema `storage`: tiene las mismas entradas para `anon`, pero se decide
--                        aparte porque afecta el comportamiento de buckets
--                        públicos. Los dos buckets actuales son privados.
--   * Objetos ya existentes: los cubre M1. ALTER DEFAULT PRIVILEGES sólo rige
--                        para objetos creados a partir de su aplicación.
--
-- ORDEN
-- Aplicar en la MISMA ventana que M1, inmediatamente después. Se mantienen
-- como archivos separados para poder revertir una sin la otra.
--
-- ROLLBACK
-- supabase/rollback/20260725_m1bis_rollback.sql
--
-- Idempotente.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 — Rol `postgres`  (OBLIGATORIO)
-- ════════════════════════════════════════════════════════════════════════════
-- Es el bloque que importa. Toda tabla creada por el equipo —desde el SQL
-- Editor, desde el editor de tablas del panel o desde una migración— queda
-- como propiedad de `postgres` y hereda estos privilegios por defecto.

begin;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke all on functions from anon;

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 — Rol `supabase_admin`  (OPCIONAL — puede fallar por permisos)
-- ════════════════════════════════════════════════════════════════════════════
-- ADVERTENCIA: ALTER DEFAULT PRIVILEGES FOR ROLE exige ser miembro del rol.
-- Es posible que `postgres` no sea miembro de `supabase_admin` y que este
-- bloque falle con:
--
--     ERROR: 42501: must be member of role "supabase_admin"
--
-- Si eso ocurre, NO es un problema: el BLOQUE 1 ya se confirmó por su propio
-- COMMIT y queda aplicado. Las tablas creadas por `supabase_admin` son objetos
-- internos de la plataforma, no tablas de la aplicación. Registrar el fallo,
-- omitir este bloque y continuar.
--
-- Ejecutar este bloque POR SEPARADO, después de confirmar que el BLOQUE 1
-- terminó bien.

begin;

alter default privileges for role supabase_admin in schema public
  revoke all on tables from anon;

alter default privileges for role supabase_admin in schema public
  revoke all on sequences from anon;

alter default privileges for role supabase_admin in schema public
  revoke all on functions from anon;

commit;


-- ============================================================================
-- Verificación inmediata
-- ============================================================================
-- Debe devolver 0 filas para el esquema public:
--
-- select pg_get_userbyid(d.defaclrole) as propietario,
--        d.defaclobjtype, d.defaclacl::text
--   from pg_default_acl d
--   join pg_namespace n on n.oid = d.defaclnamespace
--  where n.nspname = 'public'
--    and d.defaclacl::text ilike '%anon=%';
-- ============================================================================
