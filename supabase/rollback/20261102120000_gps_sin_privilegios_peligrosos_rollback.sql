-- Rollback de 20261102120000_gps_sin_privilegios_peligrosos.sql. Correr por separado.
-- Devuelve a `authenticated` los privilegios que tenía (no se usaban). `anon`
-- no tenía ninguno antes: no se le devuelve nada.

begin;

grant truncate, update, delete, references, trigger
  on public.supervisor_route_points
  to authenticated;

commit;
