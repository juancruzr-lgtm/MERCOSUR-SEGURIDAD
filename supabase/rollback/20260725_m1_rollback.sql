-- ============================================================================
-- ROLLBACK de M1 — Restituir el acceso anónimo a las tablas de public
-- ============================================================================
--
-- Revierte: supabase/migrations/20260725_m1_revoke_anon_tablas.sql
--
-- ATENCIÓN: este archivo restituye una configuración INSEGURA. Ejecutarlo
-- devuelve a `anon` el acceso completo de lectura y escritura sobre todas las
-- tablas de `public`, incluidas `usuarios` y `objetivos`. Usar solamente si
-- M1 rompió un flujo de producción y hay que recuperar el servicio de
-- inmediato.
--
-- ── CUÁL DE LAS DOS OPCIONES USAR ───────────────────────────────────────────
--
-- OPCIÓN A (preferida, exacta)
--   Si antes de aplicar M1 se guardó la salida de la sección 1.3 de
--   supabase/verificacion/20260725_m1_m1bis_pre_post.sql, esa salida son las
--   sentencias GRANT literales del estado previo, tabla por tabla y privilegio
--   por privilegio. Ejecutar ESA salida y no este archivo. Es una restitución
--   idéntica al estado anterior.
--
-- OPCIÓN B (genérica, este archivo)
--   Usar sólo si la captura previa no está disponible. Restituye el conjunto
--   completo `arwdDxtm`, que es el estado uniforme documentado en la auditoría
--   del 2026-07-25 para las 48 tablas del esquema (evidencia: pg_default_acl
--   concedía `anon=arwdDxtm` sobre cada tabla nueva, y P4_grants_muestra
--   confirmó los siete privilegios en las seis tablas verificadas).
--   Si alguna tabla hubiera tenido privilegios parciales, esta opción le
--   concedería de más. No se detectó ningún caso así.
--
-- ── DESPUÉS DE EJECUTAR ─────────────────────────────────────────────────────
--   1. Registrar qué flujo se rompió y con qué error exacto.
--   2. No reintentar M1 hasta entender la causa: la revisión del repositorio
--      no encontró ningún acceso anónimo a tablas, así que un fallo indicaría
--      un consumidor no identificado en la auditoría.
-- ============================================================================

begin;

grant all privileges on all tables    in schema public to anon;
grant all privileges on all sequences in schema public to anon;

commit;

-- ============================================================================
-- Verificación del rollback (debe devolver filas para `anon`)
-- ============================================================================
-- select table_name, count(*) as privilegios
--   from information_schema.role_table_grants
--  where table_schema = 'public' and grantee = 'anon'
--  group by table_name
--  order by table_name;
-- ============================================================================
