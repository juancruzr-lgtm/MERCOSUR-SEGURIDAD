-- ============================================================================
-- Acceso a interfaz de Administración por usuario (sin tocar rol/puesto)
-- ============================================================================
-- Flag EXPLÍCITO de acceso a la VISTA administrativa, independiente de puesto y
-- capacidades. Abrir la vista NO concede permisos: cada módulo/acción sigue
-- gateado por capability + RLS. Se usa para que Sergio Martínez (puesto
-- supervisor, alcance Rosario) recupere la interfaz admin que necesita para
-- trabajar, SIN convertirlo en administración ni darle económico/config/roles.
--
-- ROLLBACK: supabase/rollback/20260908240000_acceso_interfaz_admin_rollback.sql
-- ============================================================================

alter table public.usuarios add column if not exists acceso_interfaz_admin boolean not null default false;

-- Sergio Martínez (CUIL 20260157400): recupera la vista admin. NO cambia rol ni
-- puesto (sigue supervisor, alcance Rosario).
update public.usuarios
   set acceso_interfaz_admin = true
 where regexp_replace(coalesce(cuil,''),'\D','','g') = '20260157400';
