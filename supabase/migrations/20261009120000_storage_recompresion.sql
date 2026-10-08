-- Recompresión de fotografías históricas: registro, respaldo y reversión.
-- BORRADOR — NO APLICADA. Requiere aprobación de Gerencia.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Las fotos de supervisión de junio a agosto de 2026 se subieron sin comprimir
-- (~2,5 MB cada una, 2.207 fotos, 5,4 GB: el 63% de todo el Storage). La
-- compresión se agregó el 28/08/2026 (PR #118). Recomprimirlas al estándar
-- actual libera ~4,7 GB SIN borrar evidencia.
--
-- ── Cómo, sin romper nada ────────────────────────────────────────────────────
-- * Se reemplaza el archivo EN LA MISMA RUTA: `supervision_fotos.storage_path`
--   y cualquier otra relación siguen apuntando al mismo lugar.
-- * Antes de reemplazar, el original se copia al bucket privado
--   `respaldo-recompresion`, con la misma ruta. La reversión vuelve a copiarlo.
-- * Cada archivo deja una fila en `storage_recompresion` (antes/después:
--   bytes, eTag, SHA-256), inmutable salvo los campos de estado.
-- * Sólo buckets en lista blanca. Nunca `ia-referencias` (la ruta sale del
--   hash) ni filas con `evidencias.contenido_sha256` cargado (la IA las daría
--   por alteradas). Hoy ninguna evidencia operativa tiene hash (0 de 12.769).
-- * El script corre fuera de la app (SRV02 o local) con service_role, por
--   lotes, con interruptor y tope. Ver scripts/recomprimir-historico.mjs.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('respaldo-recompresion', 'respaldo-recompresion', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/heic']::text[])
on conflict (id) do nothing;
-- Sin policies para authenticated: sólo service_role lee y escribe.

create table if not exists public.storage_recompresion_lote (
  id            uuid primary key default gen_random_uuid(),
  bucket        text not null check (bucket in ('supervision-fotos','ronda-evidencias','ingreso-evidencias')),
  parametros    jsonb not null,           -- lado mayor, calidad, umbral de bytes
  estado        text not null default 'simulado' check (estado in ('simulado','aprobado','ejecutando','ejecutado','revertido','cancelado')),
  candidatos    integer, bytes_antes bigint, bytes_despues_estimado bigint,
  aprobado_por  uuid references public.usuarios(id), aprobado_at timestamptz,
  creado_at     timestamptz not null default now(),
  ejecutado_at  timestamptz
);

create table if not exists public.storage_recompresion (
  id              bigint generated always as identity primary key,
  lote_id         uuid not null references public.storage_recompresion_lote(id),
  bucket          text not null,
  ruta            text not null,
  bytes_antes     bigint not null,
  sha256_antes    text not null check (sha256_antes ~ '^[0-9a-f]{64}$'),
  etag_antes      text,
  dims_antes      text,
  bytes_despues   bigint,
  sha256_despues  text check (sha256_despues is null or sha256_despues ~ '^[0-9a-f]{64}$'),
  dims_despues    text,
  respaldo_ruta   text not null,          -- misma ruta en respaldo-recompresion
  estado          text not null default 'respaldado' check (estado in ('respaldado','reemplazado','omitido','revertido','error')),
  motivo          text,
  creado_at       timestamptz not null default now(),
  reemplazado_at  timestamptz,
  revertido_at    timestamptz,
  unique (lote_id, bucket, ruta)
);

-- Sólo cambian estado/fechas/resultado; lo "antes" no se toca nunca.
create or replace function public.storage_recompresion_proteger()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'El registro de recompresión no se borra' using errcode = '42501';
  end if;
  if new.bucket is distinct from old.bucket or new.ruta is distinct from old.ruta
     or new.bytes_antes is distinct from old.bytes_antes or new.sha256_antes is distinct from old.sha256_antes
     or new.respaldo_ruta is distinct from old.respaldo_ruta or new.lote_id is distinct from old.lote_id then
    raise exception 'Los datos originales de una recompresión no se modifican' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_storage_recompresion_proteger on public.storage_recompresion;
create trigger trg_storage_recompresion_proteger
  before update or delete on public.storage_recompresion
  for each row execute function public.storage_recompresion_proteger();

alter table public.storage_recompresion_lote enable row level security;
alter table public.storage_recompresion enable row level security;
revoke all on public.storage_recompresion_lote from anon, authenticated;
revoke all on public.storage_recompresion from anon, authenticated;
grant select on public.storage_recompresion_lote to authenticated;
grant select on public.storage_recompresion to authenticated;
drop policy if exists "Recompresion: Gerencia lee" on public.storage_recompresion_lote;
create policy "Recompresion: Gerencia lee" on public.storage_recompresion_lote
  for select to authenticated using (public.puede_acceder_gerencia_actual());
drop policy if exists "Recompresion: Gerencia lee items" on public.storage_recompresion;
create policy "Recompresion: Gerencia lee items" on public.storage_recompresion
  for select to authenticated using (public.puede_acceder_gerencia_actual());

-- Aprobación: sólo Gerencia, sólo un lote simulado.
create or replace function public.storage_recompresion_aprobar(p_lote uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.puede_acceder_gerencia_actual() then
    raise exception 'Sólo Gerencia aprueba una recompresión' using errcode = '42501';
  end if;
  update public.storage_recompresion_lote
     set estado = 'aprobado', aprobado_por = (select id from public.usuarios where auth_user_id = auth.uid() limit 1), aprobado_at = now()
   where id = p_lote and estado = 'simulado';
  if not found then raise exception 'El lote no existe o no está simulado'; end if;
end;
$fn$;
revoke all on function public.storage_recompresion_aprobar(uuid) from public, anon;
grant execute on function public.storage_recompresion_aprobar(uuid) to authenticated;

-- Candidatos: archivos grandes del bucket que todavía no se recomprimieron,
-- sin hash registrado en evidencias y sin análisis de IA en curso. Sólo
-- service_role (lo llama el script, no la app). Devuelve como mucho p_limite.
create or replace function public.storage_recompresion_candidatos(p_bucket text, p_min_bytes bigint, p_limite integer)
returns table (name text, bytes bigint, etag text)
language sql stable security definer set search_path = public, storage, pg_catalog as $fn$
  select o.name, (o.metadata->>'size')::bigint, o.metadata->>'eTag'
  from storage.objects o
  where o.bucket_id = p_bucket
    and p_bucket in ('supervision-fotos','ronda-evidencias','ingreso-evidencias')
    and (o.metadata->>'size')::bigint >= p_min_bytes
    and not exists (select 1 from public.storage_recompresion r
                    where r.bucket = o.bucket_id and r.ruta = o.name and r.estado in ('reemplazado','omitido'))
    and not exists (select 1 from public.evidencias e
                    where e.bucket = o.bucket_id and e.storage_path = o.name
                      and (e.contenido_sha256 is not null
                           or exists (select 1 from public.evidencia_analisis a
                                      where a.evidencia_id = e.id and a.estado in ('pendiente','procesando'))))
  order by (o.metadata->>'size')::bigint desc
  limit greatest(1, least(p_limite, 2000))
$fn$;
revoke all on function public.storage_recompresion_candidatos(text, bigint, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
