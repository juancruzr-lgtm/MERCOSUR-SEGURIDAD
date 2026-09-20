-- ============================================================================
-- Corrección del override acceso_admin_pleno: EXCLUIR LIQUIDACIONES
-- ============================================================================
--
-- JC (20/09): acceso_admin_pleno debe dar acceso amplio (operativo, personal,
-- usuarios/roles, config, económico) PERO **NO** liquidaciones. En #235 el flag
-- se sumó también a `puede_liquidar_actual()`, dándole a Sergio acceso a
-- Liquidación. Se quita esa rama: `puede_liquidar_actual()` vuelve a ser SÓLO
-- Gerencia/Administración (como antes de #235). Los otros gates del flag
-- (puede_gestionar_personal_actual, puede_gestionar_usuarios_roles_actual) NO se
-- tocan: Sergio conserva el resto del acceso amplio.
--
-- Gerencia y Administración conservan su acceso a Liquidación (no se modifica su
-- rama). No cambia ningún otro usuario ni el flag de Sergio.
--
-- ROLLBACK: supabase/rollback/20260920140000_override_admin_pleno_sin_liquidacion_rollback.sql
-- Idempotente: sí.
-- ============================================================================

-- puede_liquidar_actual SIN la rama del override (vuelve a Gerencia/Administración).
create or replace function public.puede_liquidar_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion')
$fn$;

notify pgrst, 'reload schema';
