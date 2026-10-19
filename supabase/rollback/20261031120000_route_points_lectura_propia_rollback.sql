-- Rollback de 20261031120000_route_points_lectura_propia.sql. Correr por separado.
-- Devuelve la lectura total a usuarios.rol = 'admin' (estado de 20260715).

begin;

drop policy if exists "Usuario lee sus propios recorridos" on public.supervisor_route_points;

drop policy if exists "Admin lee todos los recorridos" on public.supervisor_route_points;
create policy "Admin lee todos los recorridos"
on public.supervisor_route_points for select to authenticated
using (
  exists (
    select 1 from usuarios
    where usuarios.auth_user_id = auth.uid()
      and usuarios.rol          = 'admin'
  )
);

commit;
