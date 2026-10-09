-- Agente documental: historial de hashes (decisión H-13).
--
-- Hasta acá `repositorio_documental` sólo guardaba el hash ACTUAL y un
-- contador de versiones: si un archivo cambiaba, el hash anterior se perdía y
-- no había forma de probar qué contenido tenía cuando se clasificó o importó.
--
-- Un trigger registra cada hash nuevo (alta o cambio) en
-- `repositorio_documental_hash_historial`, que no se modifica ni se borra.
-- No requiere cambios en el agente. Se completa una fila por archivo con el
-- hash actual (versión vigente) para tener punto de partida.
--
-- Rollback: agente-documental/supabase/rollback/20261009160000_repdoc_hash_historial_rollback.sql

begin;

create table if not exists public.repositorio_documental_hash_historial (
  id               bigint generated always as identity primary key,
  repositorio_id   uuid not null references public.repositorio_documental(id) on delete restrict,
  version          integer not null,
  hash_sha256      text not null,
  tamano_bytes     bigint,
  ruta_relativa    text not null,
  detectado_at     timestamptz not null default now(),
  unique (repositorio_id, version, hash_sha256)
);

create index if not exists ix_repdoc_hash_historial_hash
  on public.repositorio_documental_hash_historial (hash_sha256);

alter table public.repositorio_documental_hash_historial enable row level security;
revoke all on table public.repositorio_documental_hash_historial from anon, authenticated;

create or replace function public.repdoc_hash_historial_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  raise exception 'El historial de hashes no se modifica ni se borra (%)', tg_op using errcode = '42501';
end;
$fn$;

drop trigger if exists trg_repdoc_hash_historial_inmutable on public.repositorio_documental_hash_historial;
create trigger trg_repdoc_hash_historial_inmutable
  before update or delete on public.repositorio_documental_hash_historial
  for each row execute function public.repdoc_hash_historial_inmutable();
drop trigger if exists trg_repdoc_hash_historial_sin_truncate on public.repositorio_documental_hash_historial;
create trigger trg_repdoc_hash_historial_sin_truncate
  before truncate on public.repositorio_documental_hash_historial
  for each statement execute function public.repdoc_hash_historial_inmutable();

create or replace function public.repdoc_registrar_hash()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if tg_op = 'INSERT' or new.hash_sha256 is distinct from old.hash_sha256 then
    insert into public.repositorio_documental_hash_historial (repositorio_id, version, hash_sha256, tamano_bytes, ruta_relativa)
    values (new.id, new.version_actual, new.hash_sha256, new.tamano_bytes, new.ruta_relativa)
    on conflict (repositorio_id, version, hash_sha256) do nothing;
  end if;
  return new;
end;
$fn$;

revoke all on function public.repdoc_registrar_hash() from public, anon, authenticated;

drop trigger if exists trg_repdoc_registrar_hash on public.repositorio_documental;
create trigger trg_repdoc_registrar_hash
  after insert or update of hash_sha256 on public.repositorio_documental
  for each row execute function public.repdoc_registrar_hash();

-- Punto de partida: el hash vigente de cada archivo ya indexado.
insert into public.repositorio_documental_hash_historial (repositorio_id, version, hash_sha256, tamano_bytes, ruta_relativa, detectado_at)
select r.id, r.version_actual, r.hash_sha256, r.tamano_bytes, r.ruta_relativa, r.detectado_por_ultima_vez_at
from public.repositorio_documental r
on conflict (repositorio_id, version, hash_sha256) do nothing;

commit;
