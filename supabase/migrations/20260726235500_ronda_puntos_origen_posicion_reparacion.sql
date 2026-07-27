-- Repara instalaciones donde la RPC agregar_ronda_punto fue creada pero la
-- columna origen_posicion no quedó aplicada en public.ronda_puntos.

begin;

alter table public.ronda_puntos
  add column if not exists origen_posicion text null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.ronda_puntos'::regclass
      and c.conname = 'ronda_puntos_origen_posicion_valido'
  ) then
    alter table public.ronda_puntos
      add constraint ronda_puntos_origen_posicion_valido
      check (origen_posicion is null or origen_posicion in ('gps', 'manual'));
  end if;
end;
$$;

grant insert (origen_posicion)
  on table public.ronda_puntos to authenticated;
grant update (origen_posicion)
  on table public.ronda_puntos to authenticated;

notify pgrst, 'reload schema';

commit;
