-- ============================================================================
-- FASE 1 — Desacoplar Config/Sistema del legacy `rol='admin'`
-- ============================================================================
--
-- JC (20/09): eliminar la dependencia accidental de usuarios.rol='admin' para
-- autorizar Config/Sistema, usando la capacidad moderna `configurar_sistema`,
-- SIN cambiar permisos efectivos. Verificado por impersonación (before/after):
-- el set con acceso a config queda IDÉNTICO — Sergio (por acceso_admin_pleno),
-- Rodolfo (dir_operativa), Administración y Gerencia SÍ; Aldo/supervisor/vigilador NO.
--
-- Alcance de esta migración (SOLO Config/Sistema):
--   · Nueva función `puede_configurar_sistema_actual()` (espejo de la capacidad TS
--     `configurar_sistema`: puesto dir_operativa/administracion/gerencia + override
--     acceso_admin_pleno + fallback puesto null & rol=admin).
--   · Reemplaza las policies rol=admin (y las duplicadas por current_usuario_rol)
--     de app_config, checklist_items, checklist_plantillas, zonas_operativas y
--     supervisor_zonas por policies basadas en esa función. Consolida duplicados.
--   · Elimina helpers legacy MUERTOS is_admin() / is_supervisor_or_admin()
--     (0 consumidores verificado: policies, funciones y vistas).
--
-- NO toca: Supervisiones, RPCs operativas ni otros gates TS (Fase 2). Conserva
-- las policies NO-admin (lectura de supervisores/operadores, SELECT abierto de
-- app_config). Conserva el fallback rol=admin dentro de las funciones de capacidad.
-- current_usuario_rol() queda definida pero SIN uso (droppable en Fase 2).
--
-- ROLLBACK: supabase/rollback/20260920160000_desacople_rol_admin_config_sistema_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- 1) Capacidad moderna (espejo de configurar_sistema de lib/capacidades.ts)
create or replace function public.puede_configurar_sistema_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('direccion_operativa','administracion','gerencia')
            or u.acceso_admin_pleno = true
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  )
$$;
revoke all on function public.puede_configurar_sistema_actual() from public, anon;
grant execute on function public.puede_configurar_sistema_actual() to authenticated;

-- 2) app_config (mantiene el SELECT abierto "Autenticados leen configuración")
drop policy if exists "Admin inserta configuración"  on public.app_config;
drop policy if exists "Admin actualiza configuración" on public.app_config;
drop policy if exists "Admin elimina configuración"   on public.app_config;
create policy app_config_config_insert on public.app_config for insert to authenticated with check (public.puede_configurar_sistema_actual());
create policy app_config_config_update on public.app_config for update to authenticated using (public.puede_configurar_sistema_actual()) with check (public.puede_configurar_sistema_actual());
create policy app_config_config_delete on public.app_config for delete to authenticated using (public.puede_configurar_sistema_actual());

-- 3) checklist_items (mantiene "Supervisor lee checklist_items")
drop policy if exists "Admin CRUD checklist_items" on public.checklist_items;
create policy checklist_items_config_all on public.checklist_items for all to authenticated using (public.puede_configurar_sistema_actual()) with check (public.puede_configurar_sistema_actual());

-- 4) checklist_plantillas (mantiene "Supervisor lee checklist_plantillas")
drop policy if exists "Admin CRUD checklist_plantillas" on public.checklist_plantillas;
create policy checklist_plantillas_config_all on public.checklist_plantillas for all to authenticated using (public.puede_configurar_sistema_actual()) with check (public.puede_configurar_sistema_actual());

-- 5) zonas_operativas — consolida 9 policies admin (rol=admin + current_usuario_rol) en 4.
--    Mantiene "Supervisor select zonas asignadas".
drop policy if exists "Admin select zonas_operativas"          on public.zonas_operativas;
drop policy if exists "zonas_operativas_admin_select"          on public.zonas_operativas;
drop policy if exists "Admin insert zonas_operativas"          on public.zonas_operativas;
drop policy if exists "Admin puede insertar zonas operativas"  on public.zonas_operativas;
drop policy if exists "zonas_operativas_admin_insert"          on public.zonas_operativas;
drop policy if exists "Admin update zonas_operativas"          on public.zonas_operativas;
drop policy if exists "zonas_operativas_admin_update"          on public.zonas_operativas;
drop policy if exists "Admin delete zonas_operativas"          on public.zonas_operativas;
drop policy if exists "zonas_operativas_admin_delete"          on public.zonas_operativas;
create policy zonas_operativas_config_select on public.zonas_operativas for select to authenticated using (public.puede_configurar_sistema_actual());
create policy zonas_operativas_config_insert on public.zonas_operativas for insert to authenticated with check (public.puede_configurar_sistema_actual());
create policy zonas_operativas_config_update on public.zonas_operativas for update to authenticated using (public.puede_configurar_sistema_actual()) with check (public.puede_configurar_sistema_actual());
create policy zonas_operativas_config_delete on public.zonas_operativas for delete to authenticated using (public.puede_configurar_sistema_actual());

-- 6) supervisor_zonas — consolida las admin duplicadas. Mantiene "Supervisor
--    select sus asignaciones" y "supervisor_zonas_lectura_operativa" (es_operador).
drop policy if exists "Admin select supervisor_zonas"          on public.supervisor_zonas;
drop policy if exists "supervisor_zonas_admin_select"          on public.supervisor_zonas;
drop policy if exists "Admin insert supervisor_zonas"          on public.supervisor_zonas;
drop policy if exists "Admin puede insertar supervisor_zonas"  on public.supervisor_zonas;
drop policy if exists "supervisor_zonas_admin_insert"          on public.supervisor_zonas;
drop policy if exists "Admin update supervisor_zonas"          on public.supervisor_zonas;
drop policy if exists "supervisor_zonas_admin_update"          on public.supervisor_zonas;
drop policy if exists "Admin delete supervisor_zonas"          on public.supervisor_zonas;
drop policy if exists "supervisor_zonas_admin_delete"          on public.supervisor_zonas;
create policy supervisor_zonas_config_select on public.supervisor_zonas for select to authenticated using (public.puede_configurar_sistema_actual());
create policy supervisor_zonas_config_insert on public.supervisor_zonas for insert to authenticated with check (public.puede_configurar_sistema_actual());
create policy supervisor_zonas_config_update on public.supervisor_zonas for update to authenticated using (public.puede_configurar_sistema_actual()) with check (public.puede_configurar_sistema_actual());
create policy supervisor_zonas_config_delete on public.supervisor_zonas for delete to authenticated using (public.puede_configurar_sistema_actual());

-- 7) Eliminar helpers legacy muertos (0 consumidores verificado)
drop function if exists public.is_admin();
drop function if exists public.is_supervisor_or_admin();

commit;

notify pgrst, 'reload schema';
