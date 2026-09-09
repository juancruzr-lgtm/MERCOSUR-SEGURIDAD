-- ============================================================================
-- ROLLBACK del hotfix — Quitar el UPDATE de las columnas de nocturnidad
-- ============================================================================
--
-- Revierte: supabase/migrations/20260904100000_hotfix_grant_columnas_nocturnidad_objetivos.sql
--
-- ATENCIÓN: volver a este estado deja ROTA la edición de objetivos desde el
-- dashboard (la pantalla manda las tres columnas en todos los guardados,
-- AppClient.tsx:3616-3618). Sólo tiene sentido si se decide que la
-- nocturnidad no debe editarse desde el navegador Y se cambia el código de la
-- pantalla para no enviar esas columnas.
-- ============================================================================

begin;

revoke update (nocturnidad_activa, nocturnidad_desde, nocturnidad_hasta)
  on table public.objetivos from authenticated;

commit;

notify pgrst, 'reload schema';

-- Verificación del rollback (no debe listar las columnas de nocturnidad):
-- select column_name from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'objetivos'
--    and grantee = 'authenticated' and privilege_type = 'UPDATE'
--  order by column_name;
