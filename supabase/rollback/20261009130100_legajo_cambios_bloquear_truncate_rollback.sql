-- Rollback de 20261009130100: vuelve el trigger de TRUNCATE a la función
-- original (que NO bloquea el TRUNCATE; ver la migración).
begin;
drop trigger if exists trg_legajo_cambios_sin_truncate on public.legajo_cambios_datos;
create trigger trg_legajo_cambios_sin_truncate
  before truncate on public.legajo_cambios_datos
  for each statement execute function public.legajo_cambio_proteger();
drop function if exists public.legajo_cambios_bloquear_truncate();
commit;
