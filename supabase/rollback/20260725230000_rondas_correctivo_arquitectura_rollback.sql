-- ADVERTENCIA: este rollback elimina puesto_id y hora_inicio de las rondas.
-- Se perderán las asignaciones operativas y horas configuradas.

begin;

do $$
begin
  raise warning 'ROLLBACK DESTRUCTIVO: se eliminaran puesto_id y hora_inicio de rondas_base';
end;
$$;

drop function if exists public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
);
drop function if exists public.estado_acceso_rondas_objetivo(uuid);

drop index if exists public.rondas_base_puesto_nombre_activo_unique;
create unique index if not exists rondas_base_objetivo_nombre_activo_unique
  on public.rondas_base (objetivo_id, lower(btrim(nombre)))
  where activo;

drop index if exists public.idx_rondas_base_puesto_activas;
alter table public.rondas_base
  drop constraint if exists rondas_base_puesto_objetivo_fkey,
  drop column if exists puesto_id,
  drop column if exists hora_inicio;

drop index if exists public.puestos_id_objetivo_unique;

commit;
