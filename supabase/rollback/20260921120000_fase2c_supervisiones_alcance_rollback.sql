-- ROLLBACK de 20260921120000_fase2c_supervisiones_alcance.sql
-- Restaura las policies legacy (rol='admin' CRUD + admin lee + supervisor
-- ownership por supervisor_id) en las 3 tablas y elimina las policies por
-- alcance y el helper. OJO: reabre el gap (jefe_supervisores vuelve a ver sólo
-- lo propio; el supervisor vuelve a ownership; depende de rol='admin').

begin;

-- supervisiones
drop policy if exists supervisiones_alcance on public.supervisiones;
create policy "Admin CRUD supervisiones" on public.supervisiones
  for all to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'))
  with check (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'));
create policy "Admin lee supervisiones" on public.supervisiones
  for select to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'));
create policy "Supervisor CRUD sus supervisiones" on public.supervisiones
  for all to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'supervisor' and usuarios.id = supervisiones.supervisor_id))
  with check (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'supervisor' and usuarios.id = supervisiones.supervisor_id));

-- supervision_fotos
drop policy if exists supervision_fotos_alcance on public.supervision_fotos;
create policy "Admin CRUD supervision_fotos" on public.supervision_fotos
  for all to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'))
  with check (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'));
create policy "Admin lee supervision_fotos" on public.supervision_fotos
  for select to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'));
create policy "Supervisor CRUD sus supervision_fotos" on public.supervision_fotos
  for all to authenticated
  using (exists (select 1 from public.supervisiones s join public.usuarios u on u.id = s.supervisor_id where u.auth_user_id = auth.uid() and u.rol = 'supervisor' and s.id = supervision_fotos.supervision_id))
  with check (exists (select 1 from public.supervisiones s join public.usuarios u on u.id = s.supervisor_id where u.auth_user_id = auth.uid() and u.rol = 'supervisor' and s.id = supervision_fotos.supervision_id));

-- supervision_respuestas
drop policy if exists supervision_respuestas_alcance on public.supervision_respuestas;
create policy "Admin CRUD supervision_respuestas" on public.supervision_respuestas
  for all to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'))
  with check (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'));
create policy "Admin lee supervision_respuestas" on public.supervision_respuestas
  for select to authenticated
  using (exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin'));
create policy "Supervisor CRUD sus supervision_respuestas" on public.supervision_respuestas
  for all to authenticated
  using (exists (select 1 from public.supervisiones s join public.usuarios u on u.id = s.supervisor_id where u.auth_user_id = auth.uid() and u.rol = 'supervisor' and s.id = supervision_respuestas.supervision_id))
  with check (exists (select 1 from public.supervisiones s join public.usuarios u on u.id = s.supervisor_id where u.auth_user_id = auth.uid() and u.rol = 'supervisor' and s.id = supervision_respuestas.supervision_id));

drop function if exists public.alcanza_supervision_actual(uuid);

commit;

notify pgrst, 'reload schema';
