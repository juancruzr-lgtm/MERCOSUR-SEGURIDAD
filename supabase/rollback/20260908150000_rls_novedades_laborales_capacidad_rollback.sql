-- ROLLBACK de 20260908150000_rls_novedades_laborales_capacidad.sql
-- Restaura la policy previa por rol='admin' y elimina las de capacidad.
begin;

drop policy if exists novedades_laborales_gestion on public.novedades_laborales;
drop policy if exists novedades_laborales_lectura_operativa on public.novedades_laborales;

create policy "Admin CRUD novedades_laborales" on public.novedades_laborales for all
  using ( exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin') )
  with check ( exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = 'admin') );

commit;
