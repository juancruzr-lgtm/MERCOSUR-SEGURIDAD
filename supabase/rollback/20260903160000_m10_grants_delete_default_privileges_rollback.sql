-- ============================================================================
-- ROLLBACK de M10 — Restituir DELETE/TRUNCATE/REFERENCES/TRIGGER a
--                   authenticated
-- ============================================================================
--
-- Revierte: supabase/migrations/20260903160000_m10_grants_delete_default_privileges.sql
--
-- ATENCIÓN: restituye una configuración INSEGURA.
--
-- OPCIÓN A (preferida, exacta): la salida guardada de la sección PRE lista
-- exactamente qué tabla tenía qué privilegio antes de M10. Reconceder ESO.
--
-- OPCIÓN B (genérica, este archivo): reconcede los cuatro privilegios sobre
-- TODAS las tablas de public. CONCEDE DE MÁS: las tablas que otras
-- migraciones ya habían revocado por su cuenta (entrenamiento_operativo,
-- evaluaciones_mensuales, intervenciones_uso_app, las tablas de rondas/IA
-- con revoke all, y las revocadas por M4..M9) quedarían con privilegios que
-- no tenían antes de M10. Usar sólo en emergencia y volver a aplicar después
-- las revocaciones de esas migraciones.
-- ============================================================================

begin;

grant delete, truncate, references, trigger
  on all tables in schema public to authenticated;

commit;

begin;

alter default privileges for role postgres in schema public
  grant delete, truncate, references, trigger on tables to authenticated;

commit;

-- Opcional; puede fallar con 42501 igual que en la migración.
begin;

alter default privileges for role supabase_admin in schema public
  grant delete, truncate, references, trigger on tables to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verificación del rollback (debe devolver muchas filas con DELETE):
-- select table_name from information_schema.role_table_grants
--  where table_schema = 'public' and grantee = 'authenticated'
--    and privilege_type = 'DELETE'
--  order by table_name;
