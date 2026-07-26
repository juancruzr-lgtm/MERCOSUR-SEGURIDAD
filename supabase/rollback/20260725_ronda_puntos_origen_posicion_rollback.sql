-- Rollback exclusivo de 20260725_ronda_puntos_origen_posicion.sql.
-- Conserva intactas las rondas, los puntos y sus coordenadas.

begin;

revoke insert (origen_posicion)
  on table public.ronda_puntos from authenticated;
revoke update (origen_posicion)
  on table public.ronda_puntos from authenticated;

alter table public.ronda_puntos
  drop constraint if exists ronda_puntos_origen_posicion_valido,
  drop column if exists origen_posicion;

commit;
