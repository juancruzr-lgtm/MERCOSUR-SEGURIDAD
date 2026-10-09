-- Recompresión de fotografías históricas de SUPERVISIÓN: registro, respaldo y reversión.
-- BORRADOR — NO APLICADA. Cada lote requiere aprobación de Gerencia.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Las fotos de supervisión de junio a agosto de 2026 se subieron sin comprimir
-- (2.116 fotos de más de 900 KB). Recomprimirlas al perfil operativo (1600 px
-- de lado mayor, calidad 75) libera ~4,7 GB SIN borrar evidencia.
--
-- ── Alcance: SÓLO `supervision-fotos` ───────────────────────────────────────
-- No se tocan rondas, fichajes (ingresos), referencias de IA ni el legajo.
-- Verificado en producción (09/10/2026, sólo lectura): las fotos de
-- supervisión no están en `evidencias`, no tienen análisis de IA ni hash
-- registrado, y su única referencia es `supervision_fotos.storage_path`, que
-- no cambia porque se reemplaza en la MISMA ruta. Efecto colateral: la caché
-- (max-age=3600) puede mostrar la versión anterior hasta una hora.
--
-- ── Cómo, sin romper nada (12 pasos) ────────────────────────────────────────
--  1. candidatos   storage_recompresion_candidatos (sólo service_role)
--  2. exclusiones  ya recomprimidas/omitidas; con hash o análisis en curso;
--                  supervisiones no OK, con ítems observados u observación que no
--                  sea de rutina (29 fotos protegidas al 09/10;
--                  2.079 candidatas, 5,54 GB → ~0,64 GB)
--  3. simulación   el script en modo `simular` NO escribe nada
--  4. aprobación   el lote PROPUESTO guarda la lista exacta de rutas (con eTag);
--                  sólo Gerencia lo aprueba (storage_recompresion_aprobar)
--  5. descarga     del original
--  6. respaldo     copia en el bucket privado `respaldo-recompresion`, misma ruta
--  7. SHA-256      del original y del respaldo (se vuelve a descargar y comparar)
--  8. compresión   1600 px / calidad 75, con la orientación aplicada
--  9. verificación la versión nueva decodifica, ahorra ≥ 40% y, ya subida, se
--                  vuelve a descargar y su SHA-256 coincide
-- 10. reemplazo    en la MISMA ruta, sólo si el eTag sigue siendo el aprobado
-- 11. registro     una fila por archivo en `storage_recompresion`
-- 12. reversión    por archivo o por lote, verificando el SHA-256 del respaldo
--
-- El respaldo NO se borra automáticamente: ni a los 30 días ni nunca sin una
-- decisión expresa y aparte.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('respaldo-recompresion', 'respaldo-recompresion', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/heic']::text[])
on conflict (id) do nothing;
-- Sin policies para authenticated: sólo service_role lee y escribe.

create table if not exists public.storage_recompresion_lote (
  id            uuid primary key default gen_random_uuid(),
  bucket        text not null check (bucket = 'supervision-fotos'),
  parametros    jsonb not null,           -- lado mayor, calidad, ahorro mínimo
  -- La lista EXACTA que se aprueba: [{"ruta","bytes","etag"}]. Se ejecuta eso
  -- y nada más; un archivo cuyo eTag cambió desde la aprobación se omite.
  rutas         jsonb not null check (jsonb_typeof(rutas) = 'array' and jsonb_array_length(rutas) between 1 and 2000),
  estado        text not null default 'propuesto' check (estado in ('propuesto','aprobado','ejecutando','ejecutado','revertido','cancelado')),
  candidatos    integer not null,
  bytes_antes   bigint not null,
  bytes_despues_estimado bigint,
  es_piloto     boolean not null default false,
  aprobado_por  uuid references public.usuarios(id), aprobado_at timestamptz,
  creado_at     timestamptz not null default now(),
  ejecutado_at  timestamptz
);

create table if not exists public.storage_recompresion (
  id              bigint generated always as identity primary key,
  lote_id         uuid not null references public.storage_recompresion_lote(id),
  bucket          text not null check (bucket = 'supervision-fotos'),
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

-- Un lote no cambia de lista ni de parámetros una vez propuesto, y no se borra.
create or replace function public.storage_recompresion_lote_proteger()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un lote de recompresión no se borra' using errcode = '42501';
  end if;
  if new.rutas is distinct from old.rutas or new.parametros is distinct from old.parametros
     or new.bucket is distinct from old.bucket or new.candidatos is distinct from old.candidatos then
    raise exception 'La lista y los parámetros de un lote no se modifican: proponer otro' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_storage_recompresion_lote_proteger on public.storage_recompresion_lote;
create trigger trg_storage_recompresion_lote_proteger
  before update or delete on public.storage_recompresion_lote
  for each row execute function public.storage_recompresion_lote_proteger();

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

-- Aprobación: sólo Gerencia, sólo un lote propuesto.
create or replace function public.storage_recompresion_aprobar(p_lote uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.puede_acceder_gerencia_actual() then
    raise exception 'Sólo Gerencia aprueba una recompresión' using errcode = '42501';
  end if;
  update public.storage_recompresion_lote
     set estado = 'aprobado', aprobado_por = (select id from public.usuarios where auth_user_id = auth.uid() limit 1), aprobado_at = now()
   where id = p_lote and estado = 'propuesto';
  if not found then raise exception 'El lote no existe o no está propuesto'; end if;
end;
$fn$;
revoke all on function public.storage_recompresion_aprobar(uuid) from public, anon;
grant execute on function public.storage_recompresion_aprobar(uuid) to authenticated;

-- Candidatos: fotos de supervisión grandes que todavía no se recomprimieron,
-- sin hash registrado en evidencias y sin análisis de IA en curso. Sólo
-- service_role (lo llama el script, no la app). Devuelve como mucho p_limite.
create or replace function public.storage_recompresion_candidatos(p_min_bytes bigint, p_limite integer)
returns table (name text, bytes bigint, etag text)
language sql stable security definer set search_path = public, storage, pg_catalog as $fn$
  select o.name, (o.metadata->>'size')::bigint, o.metadata->>'eTag'
  from storage.objects o
  where o.bucket_id = 'supervision-fotos'
    and (o.metadata->>'size')::bigint >= p_min_bytes
    and not exists (select 1 from public.storage_recompresion r
                    where r.bucket = o.bucket_id and r.ruta = o.name and r.estado in ('reemplazado','omitido'))
    and not exists (select 1 from public.evidencias e
                    where e.bucket = o.bucket_id and e.storage_path = o.name
                      and (e.contenido_sha256 is not null
                           or exists (select 1 from public.evidencia_analisis a
                                      where a.evidencia_id = e.id and a.estado in ('pendiente','procesando'))))
    -- Evidencia necesaria para auditoría: supervisiones que no terminaron OK,
    -- con algún ítem observado o con observación escrita. No se tocan.
    and not exists (select 1 from public.supervision_fotos f
                    join public.supervisiones sv on sv.id = f.supervision_id
                    where f.storage_path = o.name
                      and (sv.estado is distinct from 'ok'
                           -- Una nota general cuenta como incidencia salvo que sea de rutina
                           -- ("vig X sin novedad"): medido el 09/10.
                           or (nullif(btrim(coalesce(sv.observaciones, '')), '') is not null
                               and lower(sv.observaciones) !~ '(sin novedad|sin novedades|s/ ?n\y|sin observaciones|todo (ok|bien|en orden)|normal)')
                           or exists (select 1 from public.supervision_respuestas r
                                      where r.supervision_id = sv.id
                                        and (r.resultado = 'observado' or nullif(btrim(coalesce(r.observacion, '')), '') is not null))))
  order by (o.metadata->>'size')::bigint desc
  limit greatest(1, least(p_limite, 2000))
$fn$;
revoke all on function public.storage_recompresion_candidatos(bigint, integer) from public, anon, authenticated;
grant execute on function public.storage_recompresion_candidatos(bigint, integer) to service_role;

notify pgrst, 'reload schema';
commit;
