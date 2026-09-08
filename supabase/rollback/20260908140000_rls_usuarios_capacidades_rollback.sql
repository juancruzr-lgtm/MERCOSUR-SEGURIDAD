-- ROLLBACK de 20260908140000_rls_usuarios_capacidades.sql
-- Restaura las policies previas de usuarios (rol-based) y la policy abierta,
-- elimina el trigger y los helpers nuevos. No toca datos.
begin;

drop trigger if exists usuarios_proteger_campos_criticos on public.usuarios;
drop function if exists public.usuarios_proteger_campos_criticos();

drop policy if exists usuarios_select on public.usuarios;
drop policy if exists usuarios_insert on public.usuarios;
drop policy if exists usuarios_update on public.usuarios;
drop policy if exists usuarios_delete on public.usuarios;
drop policy if exists usuarios_vincular_auth on public.usuarios;

-- Policies previas (rol-based) + policy abierta, tal como estaban.
create policy "Admin acceso total usuarios" on public.usuarios for all using (true);
create policy usuarios_select on public.usuarios for select
  using ( public.is_supervisor_or_admin() or auth_user_id = auth.uid() );
create policy usuarios_insert on public.usuarios for insert
  with check ( public.is_admin() );
create policy usuarios_update on public.usuarios for update
  using ( public.is_admin() ) with check ( public.is_admin() );
create policy usuarios_delete on public.usuarios for delete
  using ( public.is_admin() );

drop function if exists public.puede_gestionar_usuarios_roles_actual();
drop function if exists public.puede_gestionar_personal_actual();
drop function if exists public.es_operador_actual();

commit;
