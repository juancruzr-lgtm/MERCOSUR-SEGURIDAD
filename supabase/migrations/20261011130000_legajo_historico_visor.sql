-- Archivo histórico: visualización privada y temporal de un archivo de MEGA.
--
-- ── Cómo funciona ────────────────────────────────────────────────────────────
--   1. Administración/Gerencia pide ver el archivo de una propuesta
--      (legajo_historico_solicitar_vista). La base controla el permiso, el tipo
--      de archivo, el tamaño y un tope de pedidos; queda un pedido «pendiente».
--   2. El lector de SRV02 (agente-documental/src/visor, sólo service_role) toma
--      el pedido, lee ESE archivo de la copia local de MEGA sin modificarlo,
--      verifica que el SHA-256 sea el del índice y lo sube al bucket privado
--      legajo-historico-temporal. Si el hash no coincide, no sube nada.
--   3. La app pide abrirlo (legajo_historico_abrir_vista): sólo quien lo pidió,
--      con permiso vigente y antes del vencimiento. Cada apertura queda
--      registrada; el servidor firma un enlace de 60 s.
--   4. La copia temporal vence a los 10 minutos de estar lista y se borra
--      (lector y servidor, por separado del vencimiento del enlace).
--
-- No hay acceso directo a las tablas ni al bucket desde el navegador. No toca
-- MEGA ni el índice (sin FK hacia repositorio_documental: no afecta al agente).
--
-- Rollback: supabase/rollback/20261011130000_legajo_historico_visor_rollback.sql

begin;

-- Bucket privado, sin policies: sólo service_role lee y escribe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legajo-historico-temporal', 'legajo-historico-temporal', false, 26214400,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                              allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.legajo_historico_vistas (
  id              uuid primary key default gen_random_uuid(),
  repositorio_id  uuid not null,
  propuesta_id    uuid references public.legajo_historico_propuestas(id) on delete restrict,
  ruta_relativa   text not null,
  hash_esperado   text not null check (hash_esperado ~ '^[0-9a-f]{64}$'),
  extension       text not null,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente','tomada','lista','error','vencida','eliminada')),
  motivo          text check (motivo is null or char_length(motivo) <= 200),
  solicitado_por  uuid references public.usuarios(id) on delete restrict,
  solicitado_auth uuid,
  agente_id       text,
  objeto          text,
  mime            text,
  bytes           bigint,
  hash_leido      text,
  error           text check (error is null or char_length(error) <= 300),
  creado_at       timestamptz not null default now(),
  tomada_at       timestamptz,
  lista_at        timestamptz,
  expira_at       timestamptz,
  eliminada_at    timestamptz
);
create index if not exists ix_legajo_historico_vistas_cola on public.legajo_historico_vistas (creado_at) where estado = 'pendiente';
create index if not exists ix_legajo_historico_vistas_quien on public.legajo_historico_vistas (solicitado_auth, creado_at desc);
create index if not exists ix_legajo_historico_vistas_vence on public.legajo_historico_vistas (expira_at) where objeto is not null and eliminada_at is null;

create table if not exists public.legajo_historico_vista_aperturas (
  id           bigint generated always as identity primary key,
  vista_id     uuid not null references public.legajo_historico_vistas(id) on delete restrict,
  usuario_id   uuid references public.usuarios(id) on delete restrict,
  auth_user_id uuid not null,
  ip           text,
  user_agent   text,
  at           timestamptz not null default now()
);
create index if not exists ix_legajo_historico_vista_aperturas on public.legajo_historico_vista_aperturas (vista_id, at);

alter table public.legajo_historico_vistas enable row level security;
alter table public.legajo_historico_vista_aperturas enable row level security;
-- Los DEFAULT PRIVILEGES dan todo a authenticated: se quita explícitamente.
revoke all on table public.legajo_historico_vistas, public.legajo_historico_vista_aperturas from public, anon, authenticated;

-- Las aperturas no se modifican ni se borran.
create or replace function public.legajo_historico_aperturas_inmutables()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  raise exception 'El registro de aperturas no se modifica ni se borra' using errcode = '42501';
end;
$fn$;
drop trigger if exists trg_legajo_historico_aperturas_inmutables on public.legajo_historico_vista_aperturas;
create trigger trg_legajo_historico_aperturas_inmutables
  before update or delete on public.legajo_historico_vista_aperturas
  for each row execute function public.legajo_historico_aperturas_inmutables();
drop trigger if exists trg_legajo_historico_aperturas_sin_truncate on public.legajo_historico_vista_aperturas;
create trigger trg_legajo_historico_aperturas_sin_truncate
  before truncate on public.legajo_historico_vista_aperturas
  for each statement execute function public.legajo_historico_aperturas_inmutables();

-- ── Pedido (Administración/Gerencia) ────────────────────────────────────────
create or replace function public.legajo_historico_solicitar_vista(p_propuesta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_p     public.legajo_historico_propuestas%rowtype;
  v_r     record;
  v_ext   text;
  v_tipo  text;
  v_id    uuid;
  v_est   text;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_p := (select x from public.legajo_historico_propuestas x where x.id = p_propuesta_id);
  if v_p.id is null then raise exception 'Propuesta inexistente'; end if;
  if v_p.repositorio_id is null then
    raise exception 'El archivo no está en el índice del agente: no se puede abrir con verificación';
  end if;
  v_tipo := coalesce(v_p.tipo, v_p.tipo_sugerido);
  if v_tipo is not null and exists (select 1 from public.documentacion_tipos t where t.codigo = v_tipo and t.sensibilidad = 'reservado_gerencia')
     and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo maneja Gerencia' using errcode = '42501';
  end if;
  select r.id, r.ruta_relativa, r.hash_sha256, lower(coalesce(r.extension, '')) ext, r.tamano_bytes, r.disponible
    into v_r from public.repositorio_documental r where r.id = v_p.repositorio_id;
  if v_r.id is null or not v_r.disponible then raise exception 'El archivo ya no está disponible en MEGA'; end if;
  v_ext := v_r.ext;
  if v_ext not in ('.pdf','.jpg','.jpeg','.png','.webp') then
    raise exception 'Sólo se pueden ver PDF e imágenes';
  end if;
  if coalesce(v_r.tamano_bytes, 0) > 26214400 then raise exception 'El archivo supera los 25 MB'; end if;

  -- Reusar un pedido propio en curso o vigente.
  select v.id, v.estado into v_id, v_est from public.legajo_historico_vistas v
   where v.solicitado_auth = auth.uid() and v.repositorio_id = v_r.id
     and (v.estado in ('pendiente','tomada') or (v.estado = 'lista' and v.expira_at > now() + interval '1 minute'))
   order by v.creado_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'estado', v_est, 'reusado', true);
  end if;

  if (select count(*) from public.legajo_historico_vistas v
       where v.solicitado_auth = auth.uid() and v.creado_at > now() - interval '1 hour') >= 30 then
    raise exception 'Llegaste al máximo de 30 archivos por hora';
  end if;
  if (select count(*) from public.legajo_historico_vistas v
       where v.estado in ('pendiente','tomada') and v.creado_at > now() - interval '5 minutes') >= 20 then
    raise exception 'Hay muchos pedidos en curso: probá en un minuto';
  end if;

  insert into public.legajo_historico_vistas (repositorio_id, propuesta_id, ruta_relativa, hash_esperado, extension,
                                              solicitado_por, solicitado_auth)
  values (v_r.id, v_p.id, v_r.ruta_relativa, lower(v_r.hash_sha256), v_ext,
          public.documentacion_usuario_actual(), auth.uid())
  returning id into v_id;
  perform public.legajo_historico_evento(v_p.id, 'vista_solicitada', jsonb_build_object('vista_id', v_id));
  return jsonb_build_object('id', v_id, 'estado', 'pendiente', 'reusado', false);
end;
$fn$;

-- Estado del pedido (sólo quien lo hizo). Un pedido que nadie tomó en 5 minutos
-- vence: el lector de SRV02 no está andando.
create or replace function public.legajo_historico_estado_vista(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare v public.legajo_historico_vistas%rowtype;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  update public.legajo_historico_vistas set estado = 'vencida', error = 'El lector de SRV02 no respondió'
   where id = p_id and estado = 'pendiente' and creado_at < now() - interval '5 minutes';
  v := (select x from public.legajo_historico_vistas x where x.id = p_id and x.solicitado_auth = auth.uid());
  if v.id is null then raise exception 'Pedido inexistente'; end if;
  return jsonb_build_object('id', v.id, 'estado', case when v.estado = 'lista' and v.expira_at <= now() then 'vencida' else v.estado end,
                            'error', v.error, 'mime', v.mime, 'bytes', v.bytes, 'expira_at', v.expira_at);
end;
$fn$;

-- Apertura: devuelve el objeto a firmar y deja constancia. Sólo quien lo pidió.
create or replace function public.legajo_historico_abrir_vista(p_id uuid, p_ip text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare v public.legajo_historico_vistas%rowtype;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v := (select x from public.legajo_historico_vistas x where x.id = p_id and x.solicitado_auth = auth.uid());
  if v.id is null then raise exception 'Pedido inexistente'; end if;
  if v.estado <> 'lista' or v.objeto is null or v.expira_at <= now() then
    raise exception 'El archivo ya no está disponible: pedilo de nuevo';
  end if;
  insert into public.legajo_historico_vista_aperturas (vista_id, usuario_id, auth_user_id, ip, user_agent)
  values (v.id, public.documentacion_usuario_actual(), auth.uid(), left(p_ip, 100), left(p_user_agent, 400));
  if v.propuesta_id is not null then
    perform public.legajo_historico_evento(v.propuesta_id, 'vista_abierta', jsonb_build_object('vista_id', v.id));
  end if;
  return jsonb_build_object('objeto', v.objeto, 'mime', v.mime, 'expira_at', v.expira_at);
end;
$fn$;

revoke all on function public.legajo_historico_solicitar_vista(uuid) from public, anon;
revoke all on function public.legajo_historico_estado_vista(uuid) from public, anon;
revoke all on function public.legajo_historico_abrir_vista(uuid, text, text) from public, anon;
grant execute on function public.legajo_historico_solicitar_vista(uuid) to authenticated;
grant execute on function public.legajo_historico_estado_vista(uuid) to authenticated;
grant execute on function public.legajo_historico_abrir_vista(uuid, text, text) to authenticated;

-- ── Lector de SRV02 (sólo service_role) ─────────────────────────────────────
create or replace function public.legajo_historico_vista_tomar(p_agente text)
returns table (id uuid, ruta_relativa text, hash_esperado text, extension text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
begin
  update public.legajo_historico_vistas v set estado = 'vencida', error = 'El lector de SRV02 no respondió'
   where v.estado = 'pendiente' and v.creado_at < now() - interval '5 minutes';
  return query
  update public.legajo_historico_vistas v
     set estado = 'tomada', tomada_at = now(), agente_id = left(p_agente, 100)
   where v.id = (select x.id from public.legajo_historico_vistas x where x.estado = 'pendiente'
                 order by x.creado_at limit 1 for update skip locked)
  returning v.id, v.ruta_relativa, v.hash_esperado, v.extension;
end;
$fn$;

create or replace function public.legajo_historico_vista_lista(p_id uuid, p_objeto text, p_mime text, p_bytes bigint, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare v public.legajo_historico_vistas%rowtype;
begin
  v := (select x from public.legajo_historico_vistas x where x.id = p_id for update);
  if v.id is null or v.estado <> 'tomada' then return false; end if;
  if lower(coalesce(p_hash, '')) <> v.hash_esperado then
    update public.legajo_historico_vistas set estado = 'error', hash_leido = lower(p_hash), objeto = p_objeto,
           error = 'El archivo de MEGA no coincide con el índice (hash distinto)' where id = p_id;
    return false;
  end if;
  update public.legajo_historico_vistas
     set estado = 'lista', objeto = p_objeto, mime = p_mime, bytes = p_bytes, hash_leido = lower(p_hash),
         lista_at = now(), expira_at = now() + interval '10 minutes'
   where id = p_id;
  return true;
end;
$fn$;

create or replace function public.legajo_historico_vista_error(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  update public.legajo_historico_vistas set estado = 'error', error = left(coalesce(p_error, 'Error'), 300)
   where id = p_id and estado in ('pendiente','tomada');
$fn$;

-- Copias temporales a borrar: vencidas, o subidas con error.
create or replace function public.legajo_historico_vistas_a_borrar()
returns table (id uuid, objeto text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select v.id, v.objeto from public.legajo_historico_vistas v
   where v.objeto is not null and v.eliminada_at is null
     and ((v.estado = 'lista' and v.expira_at <= now()) or v.estado in ('error','vencida'))
   order by v.expira_at nulls first
   limit 200;
$fn$;

create or replace function public.legajo_historico_vista_borrada(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  update public.legajo_historico_vistas
     set eliminada_at = now(), estado = case when estado = 'lista' then 'eliminada' else estado end
   where id = p_id and eliminada_at is null;
$fn$;

revoke all on function public.legajo_historico_vista_tomar(text) from public, anon, authenticated;
revoke all on function public.legajo_historico_vista_lista(uuid, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.legajo_historico_vista_error(uuid, text) from public, anon, authenticated;
revoke all on function public.legajo_historico_vistas_a_borrar() from public, anon, authenticated;
revoke all on function public.legajo_historico_vista_borrada(uuid) from public, anon, authenticated;
grant execute on function public.legajo_historico_vista_tomar(text) to service_role;
grant execute on function public.legajo_historico_vista_lista(uuid, text, text, bigint, text) to service_role;
grant execute on function public.legajo_historico_vista_error(uuid, text) to service_role;
grant execute on function public.legajo_historico_vistas_a_borrar() to service_role;
grant execute on function public.legajo_historico_vista_borrada(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
