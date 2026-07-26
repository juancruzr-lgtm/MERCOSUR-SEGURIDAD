-- Amplía exclusivamente la configuración de puntos de rondas nativas.
-- No modifica coordenadas existentes ni infiere su procedencia.

begin;

alter table public.ronda_puntos
  add column origen_posicion text null,
  add constraint ronda_puntos_origen_posicion_valido
    check (origen_posicion is null or origen_posicion in ('gps', 'manual'));

grant insert (origen_posicion)
  on table public.ronda_puntos to authenticated;
grant update (origen_posicion)
  on table public.ronda_puntos to authenticated;

commit;
