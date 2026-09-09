-- ============================================================================
-- M10 — Revocar DELETE/TRUNCATE/REFERENCES/TRIGGER de authenticated en todo
--       el esquema public + cerrar los DEFAULT PRIVILEGES
-- ============================================================================
--
-- Cierra la serie M4..M10 anunciada por M1.
--
-- MOTIVO
-- Diagnóstico del 2026-09-03: authenticated tiene DELETE sobre 58 tablas de
-- public. Es el efecto de los default privileges (toda tabla nueva nace con
-- DELETE y TRUNCATE para authenticated, como documentó
-- 20260826200000_entrenamiento_grants_minimos.sql: "no alcanza con conceder
-- poco, hay que revocar lo que se concede solo"). TRUNCATE ni siquiera pasa
-- por RLS. La revisión del código del 2026-09-03, actualizada el 2026-09-04
-- contra main af2540f5 (PRs #154..#160), encontró exactamente CUATRO borrados
-- físicos legítimos desde el navegador; todo lo demás se revoca.
--
-- QUÉ HACE
--   1. Revoca DELETE, TRUNCATE, REFERENCES y TRIGGER de authenticated sobre
--      todas las tablas de public (idempotente; incluye las ya revocadas por
--      migraciones anteriores y por M4..M9).
--   2. Reconcede DELETE sólo donde el navegador lo usa:
--        * objetivos          — AppClient.tsx:3713 (borrado físico, admin;
--                               protegido por objetivos_delete_admin de M6)
--        * supervisor_zonas   — AppClient.tsx:8832 (quitar supervisor de zona)
--        * supervisiones      — SupervisorMobile.tsx:2233 (borrado
--                               compensatorio si falla el guardado)
--        * nocturnidad_empleado_objetivo — AppClient.tsx:3572 (volver una
--                               excepción a "heredar"; tabla de #154,
--                               20260903180000, RLS sólo admin propia). Esa
--                               migración ya está aplicada y su GRANT
--                               explícito de DELETE caería con el revoke
--                               global de acá: se reconcede para conservar
--                               exactamente el estado que ella declaró.
--   3. ALTER DEFAULT PRIVILEGES para que las tablas FUTURAS ya no nazcan con
--      esos cuatro privilegios. A diferencia de M1-bis (que decidió no tocar
--      authenticated para no obligar a un GRANT por cada tabla nueva), acá se
--      revocan sólo los cuatro privilegios peligrosos: las tablas nuevas
--      siguen naciendo con SELECT/INSERT/UPDATE y las pantallas no requieren
--      GRANT manual; un DELETE nuevo se concede a mano cuando se justifique.
--
-- QUÉ NO TOCA
--   * SELECT, INSERT y UPDATE de authenticated: intactos (los contiene RLS).
--   * service_role y anon (anon ya quedó en cero con M1/M1-bis).
--   * Secuencias y funciones.
--   * Otros esquemas (storage se decide aparte, igual que en M1).
--
-- ORDEN: aplicar DESPUÉS de M4..M9 (las políticas por tabla ya en su lugar).
--
-- ANTES DE EJECUTAR: correr y GUARDAR la sección PRE de
-- supabase/verificacion/20260903160000_m10_grants_delete_default_privileges_pre_post.sql
-- (es la lista exacta de qué tabla tenía qué privilegio: la fuente del
-- rollback fino).
--
-- ROLLBACK: supabase/rollback/20260903160000_m10_grants_delete_default_privileges_rollback.sql
-- Idempotente: sí.
-- ============================================================================

-- ── BLOQUE 1: tablas existentes + re-grants ─────────────────────────────────

begin;

revoke delete, truncate, references, trigger
  on all tables in schema public from authenticated;

grant delete on table public.objetivos                      to authenticated;
grant delete on table public.supervisor_zonas               to authenticated;
grant delete on table public.supervisiones                  to authenticated;
grant delete on table public.nocturnidad_empleado_objetivo  to authenticated;

commit;

-- ── BLOQUE 2: default privileges del rol postgres (obligatorio) ─────────────

begin;

alter default privileges for role postgres in schema public
  revoke delete, truncate, references, trigger on tables from authenticated;

commit;

-- ── BLOQUE 3: default privileges del rol supabase_admin (opcional) ──────────
-- Puede fallar con "ERROR: 42501: must be member of role supabase_admin"
-- según el usuario con que se ejecute; es aceptable (precedente: M1-bis,
-- Bloque 2). Los bloques 1 y 2 ya quedaron confirmados.

begin;

alter default privileges for role supabase_admin in schema public
  revoke delete, truncate, references, trigger on tables from authenticated;

commit;

notify pgrst, 'reload schema';
