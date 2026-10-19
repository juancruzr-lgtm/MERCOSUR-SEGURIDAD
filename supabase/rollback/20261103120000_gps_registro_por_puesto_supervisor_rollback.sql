-- Rollback de 20261103120000_gps_registro_por_puesto_supervisor.sql. Correr por separado.
-- Vuelve la política de INSERT a la de 20260715 (sólo rol = 'supervisor').
-- Los puntos que Sergio haya registrado mientras tanto quedan guardados.

begin;

drop policy if exists "Supervisor inserta sus propios puntos GPS" on public.supervisor_route_points;

create policy "Supervisor inserta sus propios puntos GPS"
on public.supervisor_route_points for insert to authenticated
with check (
  exists (
    select 1 from public.usuarios
     where usuarios.auth_user_id = auth.uid()
       and usuarios.id           = supervisor_route_points.supervisor_id
       and usuarios.rol          = 'supervisor'
  )
);

commit;
