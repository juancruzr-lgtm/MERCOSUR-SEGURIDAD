-- Corrige 20261009130000: el TRUNCATE de legajo_cambios_datos NO estaba bloqueado.
--
-- trg_legajo_cambios_sin_truncate usaba legajo_cambio_proteger(), pensada para
-- UPDATE/DELETE fila por fila. En un trigger de sentencia (TRUNCATE) OLD y NEW
-- llegan en NULL: ninguna condición se cumple, la función devuelve NEW y el
-- TRUNCATE pasa sin error (probado en PostgreSQL 17). authenticated no tiene
-- privilegio TRUNCATE, pero la protección tiene que valer también para
-- service_role y para el dueño de la tabla.
--
-- Arreglo: función propia que rechaza siempre, y el trigger apunta a ella.
-- legajo_cambio_proteger() queda igual (UPDATE/DELETE funcionan bien).
-- Rollback: supabase/rollback/20261009130100_legajo_cambios_bloquear_truncate_rollback.sql

begin;

create or replace function public.legajo_cambios_bloquear_truncate()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  raise exception 'Los cambios del legajo no se borran' using errcode = '42501';
end;
$fn$;
revoke all on function public.legajo_cambios_bloquear_truncate() from public, anon, authenticated;

drop trigger if exists trg_legajo_cambios_sin_truncate on public.legajo_cambios_datos;
create trigger trg_legajo_cambios_sin_truncate
  before truncate on public.legajo_cambios_datos
  for each statement execute function public.legajo_cambios_bloquear_truncate();

commit;
