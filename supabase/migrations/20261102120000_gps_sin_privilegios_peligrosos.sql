-- GPS de supervisores: sin privilegios de modificación ni borrado para la app.
--
-- ── Qué resuelve (JC 19/10, corrección B; reemplaza la propuesta de #330) ────
-- Los DEFAULT PRIVILEGES de Supabase le dieron a `authenticated` (cualquier
-- usuario logueado) TODOS los privilegios sobre supervisor_route_points:
-- DELETE, UPDATE, TRUNCATE, REFERENCES y TRIGGER, además de INSERT y SELECT.
--  · UPDATE y DELETE hoy los frena la RLS (no hay políticas que los permitan).
--  · TRUNCATE NO pasa por RLS: el privilegio no debería existir.
--  · Nada en la app actualiza, borra ni trunca puntos GPS: el único uso es el
--    insert de lib/supervisor-gps.ts y la lectura por políticas y funciones.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- Le quita a `authenticated` y a `anon`: TRUNCATE, UPDATE, DELETE, REFERENCES
-- y TRIGGER. Quedan INSERT (registrar puntos) y SELECT (leer según la RLS).
--
-- ── Qué NO toca ──────────────────────────────────────────────────────────────
-- Ninguna política de lectura ni de escritura: Administración (incluido
-- Sergio) sigue leyendo los recorridos como hoy, cada supervisor lee y
-- registra los suyos como hoy. No toca service_role, otras tablas, funciones
-- ni mapas. Las funciones del legajo corren como postgres: no las afecta.
--
-- Rollback: supabase/rollback/20261102120000_gps_sin_privilegios_peligrosos_rollback.sql
-- Verificación: supabase/verificacion/gps_sin_privilegios_peligrosos_post_migracion.sql

begin;

revoke truncate, update, delete, references, trigger
  on public.supervisor_route_points
  from authenticated, anon;

commit;
