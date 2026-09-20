-- ROLLBACK de 20260920160000_desacople_rol_admin_config_sistema.sql
-- Restaura las policies de Config por rol=admin (una canónica por comando) y los
-- helpers muertos; quita las policies/función nuevas. No restaura los duplicados
-- redundantes (eran equivalentes).
begin;

-- quitar policies nuevas
drop policy if exists app_config_config_insert on public.app_config;
drop policy if exists app_config_config_update on public.app_config;
drop policy if exists app_config_config_delete on public.app_config;
drop policy if exists checklist_items_config_all on public.checklist_items;
drop policy if exists checklist_plantillas_config_all on public.checklist_plantillas;
drop policy if exists zonas_operativas_config_select on public.zonas_operativas;
drop policy if exists zonas_operativas_config_insert on public.zonas_operativas;
drop policy if exists zonas_operativas_config_update on public.zonas_operativas;
drop policy if exists zonas_operativas_config_delete on public.zonas_operativas;
drop policy if exists supervisor_zonas_config_select on public.supervisor_zonas;
drop policy if exists supervisor_zonas_config_insert on public.supervisor_zonas;
drop policy if exists supervisor_zonas_config_update on public.supervisor_zonas;
drop policy if exists supervisor_zonas_config_delete on public.supervisor_zonas;

-- restaurar policies rol=admin (canónicas)
create policy "Admin inserta configuración" on public.app_config for insert to authenticated with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin actualiza configuración" on public.app_config for update to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin')) with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin elimina configuración" on public.app_config for delete to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin CRUD checklist_items" on public.checklist_items for all to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin')) with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin CRUD checklist_plantillas" on public.checklist_plantillas for all to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin')) with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin select zonas_operativas" on public.zonas_operativas for select to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin insert zonas_operativas" on public.zonas_operativas for insert to authenticated with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin update zonas_operativas" on public.zonas_operativas for update to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin')) with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin delete zonas_operativas" on public.zonas_operativas for delete to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin select supervisor_zonas" on public.supervisor_zonas for select to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin insert supervisor_zonas" on public.supervisor_zonas for insert to authenticated with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin update supervisor_zonas" on public.supervisor_zonas for update to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin')) with check (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));
create policy "Admin delete supervisor_zonas" on public.supervisor_zonas for delete to authenticated using (exists(select 1 from public.usuarios where usuarios.auth_user_id=auth.uid() and usuarios.rol='admin'));

-- recrear helpers muertos
create or replace function public.is_admin() returns boolean language sql security definer set search_path to 'public' as $fn$ select public.current_user_role() = 'admin'; $fn$;
create or replace function public.is_supervisor_or_admin() returns boolean language sql security definer set search_path to 'public' as $fn$ select public.current_user_role() in ('admin','supervisor'); $fn$;

-- quitar la función de capacidad nueva
drop function if exists public.puede_configurar_sistema_actual();

commit;
notify pgrst, 'reload schema';
