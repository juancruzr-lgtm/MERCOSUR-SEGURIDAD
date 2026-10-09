-- Legajo Digital — Etapa 2: documentación del legajo.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Cada persona sube su documentación desde el celular (DNI y credencial con
-- frente y dorso, fotos o PDF) y deja constancia de la que le carga
-- Administración (recepción, conformidad o toma de conocimiento). Lista de
-- Gerencia (08/10/2026): los 17 requisitos + actuaciones legales reservadas.
-- Los adicionales de la decisión H-9 quedan cargados pero INACTIVOS.
--
-- ── Presentado ≠ validado ────────────────────────────────────────────────────
--   lo sube la persona       → pendiente_revision (PRESENTADO, sin validar)
--                              → aprobado (VALIDADO) | rechazado
--   lo carga Administración  → pendiente_aceptacion → aceptado | observado
--   (o se importa del histórico, origen 'historico', mismo circuito)
--   cualquiera               → reemplazado (llegó uno nuevo) | anulado (error)
-- "No corresponde" y "solicitado" son situaciones por tipo y persona
-- (documentacion_situaciones), no estados de un documento.
--
-- ── Archivos ─────────────────────────────────────────────────────────────────
-- Bucket privado `legajo-documentos`. El celular sube DIRECTO a Storage (Vercel
-- corta en 4,5 MB) a una ruta reservada por `documentacion_preparar`. Después
-- el servidor (/api/documentacion/confirmar) descarga cada archivo, comprueba
-- el tipo real y calcula el SHA-256; lo registra con
-- `documentacion_registrar_verificacion` (sólo service_role) y recién ahí
-- `documentacion_confirmar` acepta el documento. Huellas repetidas se
-- rechazan (mismo archivo dos veces, o ya cargado en este u otro legajo).
--
-- NADIE lee el bucket directo: no hay policy de SELECT. Los enlaces (60 s) los
-- firma /api/documentacion/archivo después de `documentacion_abrir` (sólo
-- service_role, con la identidad verificada por el servidor), que controla el
-- permiso y registra el acceso en documentacion_accesos.
--
-- ── Quién ve qué ─────────────────────────────────────────────────────────────
--   persona         lo propio (salvo reservado_gerencia); sólo vista
--   Administración  todo salvo reservado_gerencia; vista y descarga
--   Gerencia        todo
--   Supervisión     nada
-- Nadie deja una constancia por otro: `documentacion_responder` exige que el
-- documento sea de quien llama, y que antes haya abierto el archivo.
--
-- ── Qué NO toca ──────────────────────────────────────────────────────────────
-- Sindicato, embargos y suspensiones se LEEN (fechas y referencias, nunca
-- importes ni datos bancarios) sólo para mostrarlos como referencia. No se
-- escribe nada en Liquidación, sueldos, horas, novedades ni en el Estatuto.
--
-- ── Auditoría ────────────────────────────────────────────────────────────────
-- Nada se borra. Archivos, verificaciones, eventos, constancias, accesos y
-- situaciones son inmutables (trigger, también para service_role).
--
-- Reglas SQL del proyecto: nada de `select col into variable`.
-- Rollback: supabase/rollback/20261009140000_documentacion_legajo_rollback.sql.

begin;

-- ============================================================================
-- 1. CATÁLOGO
-- ============================================================================

create table if not exists public.documentacion_tipos (
  codigo             text primary key,
  nombre             text not null,
  ayuda              text,
  orden              integer not null,
  -- obligatorio: cuenta como faltante. opcional: "si lo tiene".
  -- si_corresponde: sólo cuando existe (baja, sindicato, embargos, sanciones…).
  requisito          text not null check (requisito in ('obligatorio','opcional','si_corresponde')),
  etapa              text not null check (etapa in ('ingreso','permanencia','egreso','legal')),
  -- Etiquetas de cada cara (Frente/Dorso). Null = páginas libres.
  caras              text[],
  multiple           boolean not null default false,
  campo_fecha        text not null default 'opcional' check (campo_fecha in ('obligatoria','opcional','no')),
  etiqueta_fecha     text not null default 'Fecha de emisión',
  -- no | calculado (emisión + vigencia_meses) | declarado (escrito en el documento)
  campo_vencimiento  text not null default 'no' check (campo_vencimiento in ('no','calculado','declarado')),
  vigencia_meses     integer check (vigencia_meses is null or vigencia_meses > 0),
  etiqueta_detalle   text,
  sube_vigilador     boolean not null,
  sensibilidad       text not null check (sensibilidad in ('comun','sensible','reservado_gerencia')),
  -- Qué deja la persona cuando se lo carga Administración.
  constancia         text not null check (constancia in ('conformidad','recepcion','toma_conocimiento','ninguna')),
  texto_constancia   text,
  referencia         text check (referencia in ('sindicato','embargos','suspensiones')),
  activo             boolean not null default true,
  constraint documentacion_tipos_vencimiento check (
    (campo_vencimiento = 'calculado') = (vigencia_meses is not null)
  ),
  constraint documentacion_tipos_constancia check (
    (constancia = 'ninguna') = (texto_constancia is null)
  ),
  constraint documentacion_tipos_reservado check (
    sensibilidad <> 'reservado_gerencia' or (not sube_vigilador and constancia = 'ninguna')
  )
);

comment on table public.documentacion_tipos is
  'Catalogo de la documentacion del legajo (lista de Gerencia 08/10/2026; adicionales H-9 inactivos).';

-- ============================================================================
-- 2. DOCUMENTOS, ARCHIVOS, VERIFICACIONES Y EVENTOS
-- ============================================================================

create table if not exists public.documentacion_documentos (
  id                   uuid primary key default gen_random_uuid(),
  empleado_id          uuid not null references public.usuarios(id) on delete restrict,
  tipo                 text not null references public.documentacion_tipos(codigo),
  -- Copia del catálogo al cargarlo: la RLS no depende de un cambio posterior.
  sensibilidad         text not null check (sensibilidad in ('comun','sensible','reservado_gerencia')),
  detalle              text check (detalle is null or char_length(detalle) <= 200),
  fecha_emision        date,
  vence_el             date,
  origen               text not null check (origen in ('vigilador','administracion','historico')),
  -- Trazabilidad con el archivo histórico (MEGA, vía agente documental).
  repositorio_id       uuid references public.repositorio_documental(id) on delete restrict,
  ruta_origen          text,
  hash_origen          text check (hash_origen is null or hash_origen ~ '^[0-9a-f]{64}$'),
  estado               text not null default 'subiendo' check (estado in (
                         'subiendo','pendiente_revision','pendiente_aceptacion',
                         'aprobado','aceptado','rechazado','observado',
                         'reemplazado','anulado')),
  subido_por           uuid references public.usuarios(id) on delete restrict,
  subido_por_auth      uuid,
  creado_at            timestamptz not null default now(),
  confirmado_at        timestamptz,
  revisado_por         uuid references public.usuarios(id) on delete restrict,
  revisado_at          timestamptz,
  motivo_rechazo       text,
  respondido_at        timestamptz,
  respuesta            text check (respuesta in ('conformidad','recepcion','toma_conocimiento','observacion')),
  respuesta_comentario text,
  reemplazado_por      uuid references public.documentacion_documentos(id),
  reemplazado_at       timestamptz,
  anulado_por          uuid references public.usuarios(id) on delete restrict,
  anulado_at           timestamptz,
  motivo_anulacion     text,
  constraint documentacion_documentos_origen check (
    (origen = 'historico' and repositorio_id is not null and hash_origen is not null)
    or (origen <> 'historico' and subido_por is not null and subido_por_auth is not null)
  )
);

create index if not exists ix_documentacion_documentos_empleado
  on public.documentacion_documentos (empleado_id, tipo);
create index if not exists ix_documentacion_documentos_estado
  on public.documentacion_documentos (estado);
-- Un archivo histórico entra una sola vez (salvo que se haya anulado).
create unique index if not exists ux_documentacion_documentos_repositorio
  on public.documentacion_documentos (repositorio_id)
  where repositorio_id is not null and estado <> 'anulado';

create table if not exists public.documentacion_archivos (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references public.documentacion_documentos(id) on delete restrict,
  orden         smallint not null check (orden between 1 and 10),
  cara          text,
  ruta          text not null unique,
  mime          text not null check (mime in ('image/jpeg','image/png','image/webp','application/pdf')),
  bytes         integer not null check (bytes > 0 and bytes <= 15728640),
  -- Huella que declaró el navegador; la que vale es la verificada.
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  creado_at     timestamptz not null default now(),
  unique (documento_id, orden)
);

create index if not exists ix_documentacion_archivos_sha on public.documentacion_archivos (sha256);

-- Lo que comprobó el servidor sobre el archivo realmente guardado.
create table if not exists public.documentacion_verificaciones (
  archivo_id    uuid primary key references public.documentacion_archivos(id) on delete restrict,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_real     text not null,
  bytes         integer not null,
  at            timestamptz not null default now()
);

create table if not exists public.documentacion_eventos (
  id            bigint generated always as identity primary key,
  documento_id  uuid not null references public.documentacion_documentos(id) on delete restrict,
  evento        text not null,
  usuario_id    uuid references public.usuarios(id) on delete restrict,
  auth_user_id  uuid,
  at            timestamptz not null default now(),
  detalle       jsonb
);

create index if not exists ix_documentacion_eventos_documento
  on public.documentacion_eventos (documento_id);

-- ============================================================================
-- 3. CONSTANCIAS, ACCESOS Y SITUACIONES
-- ============================================================================

-- Patrón del Estatuto (apertura previa + declaración expresa), con IP,
-- navegador y las huellas de lo que la persona vio.
create table if not exists public.documentacion_constancias (
  id               bigint generated always as identity primary key,
  documento_id     uuid not null references public.documentacion_documentos(id) on delete restrict,
  empleado_id      uuid not null references public.usuarios(id) on delete restrict,
  auth_user_id     uuid not null,
  tipo             text not null check (tipo in ('lectura','recepcion','conformidad','toma_conocimiento','observacion')),
  texto            text,
  comentario       text check (comentario is null or char_length(comentario) <= 500),
  archivos_sha256  text[] not null,
  ip               text,
  user_agent       text,
  at               timestamptz not null default now()
);

-- La lectura es una sola: la primera vez que abrió el archivo.
create unique index if not exists ux_documentacion_constancias_lectura
  on public.documentacion_constancias (documento_id) where tipo = 'lectura';
create index if not exists ix_documentacion_constancias_documento
  on public.documentacion_constancias (documento_id);

create table if not exists public.documentacion_accesos (
  id            bigint generated always as identity primary key,
  archivo_id    uuid not null references public.documentacion_archivos(id) on delete restrict,
  documento_id  uuid not null references public.documentacion_documentos(id) on delete restrict,
  empleado_id   uuid not null references public.usuarios(id) on delete restrict,
  usuario_id    uuid not null references public.usuarios(id) on delete restrict,
  auth_user_id  uuid not null,
  modo          text not null check (modo in ('ver','descargar')),
  ip            text,
  user_agent    text,
  at            timestamptz not null default now()
);

create index if not exists ix_documentacion_accesos_empleado
  on public.documentacion_accesos (empleado_id, at desc);

-- Por persona y tipo: la última fila manda. 'sin_efecto' levanta la anterior.
create table if not exists public.documentacion_situaciones (
  id            bigint generated always as identity primary key,
  empleado_id   uuid not null references public.usuarios(id) on delete restrict,
  tipo          text not null references public.documentacion_tipos(codigo),
  situacion     text not null check (situacion in ('no_corresponde','solicitado','sin_efecto')),
  motivo        text check (motivo is null or char_length(motivo) <= 300),
  usuario_id    uuid not null references public.usuarios(id) on delete restrict,
  at            timestamptz not null default now()
);

create index if not exists ix_documentacion_situaciones_empleado
  on public.documentacion_situaciones (empleado_id, tipo, id desc);

-- ============================================================================
-- 4. INMUTABILIDAD
-- ============================================================================

create or replace function public.documentacion_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  raise exception 'La documentacion del legajo no se borra ni se modifica (% en %)', tg_op, tg_table_name
    using errcode = '42501';
end;
$fn$;

do $do$
declare t text;
begin
  foreach t in array array['documentacion_archivos','documentacion_verificaciones','documentacion_eventos',
                           'documentacion_constancias','documentacion_accesos','documentacion_situaciones'] loop
    execute format('drop trigger if exists trg_%1$s_inmutable on public.%1$I', t);
    execute format('create trigger trg_%1$s_inmutable before update or delete on public.%1$I
                    for each row execute function public.documentacion_inmutable()', t);
    execute format('drop trigger if exists trg_%1$s_sin_truncate on public.%1$I', t);
    execute format('create trigger trg_%1$s_sin_truncate before truncate on public.%1$I
                    for each statement execute function public.documentacion_inmutable()', t);
  end loop;
end;
$do$;

drop trigger if exists trg_documentacion_documentos_sin_delete on public.documentacion_documentos;
create trigger trg_documentacion_documentos_sin_delete
  before delete on public.documentacion_documentos
  for each row execute function public.documentacion_inmutable();
drop trigger if exists trg_documentacion_documentos_sin_truncate on public.documentacion_documentos;
create trigger trg_documentacion_documentos_sin_truncate
  before truncate on public.documentacion_documentos
  for each statement execute function public.documentacion_inmutable();

-- Un documento cambia de estado, pero no de dueño, tipo, origen ni datos.
create or replace function public.documentacion_documento_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  if new.empleado_id     is distinct from old.empleado_id
  or new.tipo            is distinct from old.tipo
  or new.sensibilidad    is distinct from old.sensibilidad
  or new.origen          is distinct from old.origen
  or new.repositorio_id  is distinct from old.repositorio_id
  or new.ruta_origen     is distinct from old.ruta_origen
  or new.hash_origen     is distinct from old.hash_origen
  or new.subido_por      is distinct from old.subido_por
  or new.subido_por_auth is distinct from old.subido_por_auth
  or new.creado_at       is distinct from old.creado_at
  or new.detalle         is distinct from old.detalle
  or new.fecha_emision   is distinct from old.fecha_emision
  or new.vence_el        is distinct from old.vence_el then
    raise exception 'Un documento del legajo no cambia de persona, tipo, origen ni datos: cargar uno nuevo'
      using errcode = '42501';
  end if;
  if old.estado in ('reemplazado','anulado') and new.estado is distinct from old.estado then
    raise exception 'Un documento reemplazado o anulado no vuelve a estar vigente'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_documentacion_documento_proteger on public.documentacion_documentos;
create trigger trg_documentacion_documento_proteger
  before update on public.documentacion_documentos
  for each row execute function public.documentacion_documento_proteger();

-- ============================================================================
-- 5. PERMISOS Y RLS
-- ============================================================================

alter table public.documentacion_tipos          enable row level security;
alter table public.documentacion_documentos     enable row level security;
alter table public.documentacion_archivos       enable row level security;
alter table public.documentacion_verificaciones enable row level security;
alter table public.documentacion_eventos        enable row level security;
alter table public.documentacion_constancias    enable row level security;
alter table public.documentacion_accesos        enable row level security;
alter table public.documentacion_situaciones    enable row level security;

-- Los DEFAULT PRIVILEGES conceden de más: se revoca todo y se da sólo SELECT.
-- Toda escritura es por RPC SECURITY DEFINER.
revoke all on table public.documentacion_tipos          from anon, authenticated;
revoke all on table public.documentacion_documentos     from anon, authenticated;
revoke all on table public.documentacion_archivos       from anon, authenticated;
revoke all on table public.documentacion_verificaciones from anon, authenticated;
revoke all on table public.documentacion_eventos        from anon, authenticated;
revoke all on table public.documentacion_constancias    from anon, authenticated;
revoke all on table public.documentacion_accesos        from anon, authenticated;
revoke all on table public.documentacion_situaciones    from anon, authenticated;
grant select on table public.documentacion_tipos, public.documentacion_documentos,
  public.documentacion_archivos, public.documentacion_eventos, public.documentacion_constancias,
  public.documentacion_accesos, public.documentacion_situaciones to authenticated;

create or replace function public.documentacion_es_gerencia()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  -- Puesto Gerencia o delegación vigente. Sin el comodín "rol admin sin puesto".
  select auth.uid() is not null
     and (exists (select 1 from public.usuarios u
                  where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional = 'gerencia')
          or coalesce(public.tiene_delegacion_gerencia_actual(), false))
$fn$;

create or replace function public.documentacion_puede_gestionar()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  -- La misma regla que los datos personales (legajo_puede_gestionar): sólo
  -- puesto Administración o Gerencia, o delegación de Gerencia. Sin overrides
  -- (acceso_admin_pleno): Supervisión y Dirección Operativa no acceden.
  select public.legajo_puede_gestionar()
$fn$;

-- La regla única de lectura de un documento.
create or replace function public.documentacion_puede_ver(
  p_empleado_id uuid, p_sensibilidad text, p_estado text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select auth.uid() is not null and (
    public.documentacion_es_gerencia()
    or (p_sensibilidad <> 'reservado_gerencia' and (
          public.documentacion_puede_gestionar()
          or (p_empleado_id = public.rondas_usuario_actual_id()
              and p_estado not in ('subiendo','anulado'))))
  )
$fn$;

revoke all on function public.documentacion_es_gerencia() from public, anon;
revoke all on function public.documentacion_puede_gestionar() from public, anon;
revoke all on function public.documentacion_puede_ver(uuid, text, text) from public, anon;
grant execute on function public.documentacion_es_gerencia() to authenticated;
grant execute on function public.documentacion_puede_gestionar() to authenticated;
grant execute on function public.documentacion_puede_ver(uuid, text, text) to authenticated;

drop policy if exists "Documentacion: catalogo" on public.documentacion_tipos;
create policy "Documentacion: catalogo"
  on public.documentacion_tipos for select to authenticated
  using (sensibilidad <> 'reservado_gerencia' or public.documentacion_es_gerencia());

drop policy if exists "Documentacion: documentos visibles" on public.documentacion_documentos;
create policy "Documentacion: documentos visibles"
  on public.documentacion_documentos for select to authenticated
  using (public.documentacion_puede_ver(empleado_id, sensibilidad, estado));

drop policy if exists "Documentacion: archivos visibles" on public.documentacion_archivos;
create policy "Documentacion: archivos visibles"
  on public.documentacion_archivos for select to authenticated
  using (exists (select 1 from public.documentacion_documentos d where d.id = documento_id));

drop policy if exists "Documentacion: eventos visibles" on public.documentacion_eventos;
create policy "Documentacion: eventos visibles"
  on public.documentacion_eventos for select to authenticated
  using (exists (select 1 from public.documentacion_documentos d where d.id = documento_id));

drop policy if exists "Documentacion: constancias visibles" on public.documentacion_constancias;
create policy "Documentacion: constancias visibles"
  on public.documentacion_constancias for select to authenticated
  using (exists (select 1 from public.documentacion_documentos d where d.id = documento_id));

-- El registro de accesos: Administración y Gerencia (no la persona).
drop policy if exists "Documentacion: accesos" on public.documentacion_accesos;
create policy "Documentacion: accesos"
  on public.documentacion_accesos for select to authenticated
  using (public.documentacion_puede_gestionar()
         and exists (select 1 from public.documentacion_documentos d where d.id = documento_id));

drop policy if exists "Documentacion: situaciones" on public.documentacion_situaciones;
create policy "Documentacion: situaciones"
  on public.documentacion_situaciones for select to authenticated
  using (exists (select 1 from public.documentacion_tipos t where t.codigo = tipo)
         and (public.documentacion_puede_gestionar() or empleado_id = public.rondas_usuario_actual_id()));

-- Habilitación progresiva (ver legajo_habilitacion, Etapa 1): el módulo
-- arranca cerrado para el personal; Administración, Gerencia y cuentas de
-- prueba lo usan igual.
insert into public.legajo_habilitacion (modulo) values ('documentacion') on conflict (modulo) do nothing;

-- ============================================================================
-- 6. STORAGE
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'legajo-documentos', 'legajo-documentos', false, 15728640,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update
set public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Subir: sólo a una ruta que reservó quien sube, sin confirmar y de las
-- últimas 24 horas. No hay policy de SELECT, UPDATE ni DELETE: nadie lee ni
-- pisa directo.
create or replace function public.documentacion_puede_subir_objeto(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select auth.uid() is not null and exists (
    select 1
    from public.documentacion_archivos a
    join public.documentacion_documentos d on d.id = a.documento_id
    where a.ruta = p_ruta
      and d.estado = 'subiendo'
      and d.subido_por_auth = auth.uid()
      and d.creado_at > now() - interval '24 hours'
  )
$fn$;

revoke all on function public.documentacion_puede_subir_objeto(text) from public, anon;
grant execute on function public.documentacion_puede_subir_objeto(text) to authenticated;

drop policy if exists "Legajo documentos: subir ruta reservada" on storage.objects;
create policy "Legajo documentos: subir ruta reservada"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'legajo-documentos' and public.documentacion_puede_subir_objeto(name));

-- ============================================================================
-- 7. AUXILIARES (sin ejecución para clientes)
-- ============================================================================

create or replace function public.documentacion_usuario_actual()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select u.id from public.usuarios u
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1
$fn$;

-- IP y navegador del pedido (PostgREST expone los encabezados). Se guarda la
-- cadena de x-forwarded-for completa: es lo que llegó, sin interpretarlo.
create or replace function public.documentacion_cliente()
returns table (ip text, user_agent text)
language plpgsql
stable
set search_path = public, pg_catalog
as $fn$
declare
  h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  return query select
    left(coalesce(h->>'x-forwarded-for', h->>'x-real-ip', h->>'cf-connecting-ip'), 200),
    left(h->>'user-agent', 400);
end;
$fn$;

create or replace function public.documentacion_registrar_evento(
  p_documento_id uuid, p_evento text, p_detalle jsonb default null
)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  insert into public.documentacion_eventos (documento_id, evento, usuario_id, auth_user_id, detalle)
  values (p_documento_id, p_evento, public.documentacion_usuario_actual(), auth.uid(), p_detalle)
$fn$;

-- Huellas verificadas de un documento, en orden (lo que queda en la constancia).
create or replace function public.documentacion_huellas(p_documento_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select coalesce(array_agg(v.sha256 order by a.orden), array[]::text[])
  from public.documentacion_archivos a
  join public.documentacion_verificaciones v on v.archivo_id = a.id
  where a.documento_id = p_documento_id
$fn$;

-- ¿Esta huella ya está en algún documento vigente o en trámite? Devuelve el
-- mensaje de rechazo o null. Excluye el propio documento y los anulados.
create or replace function public.documentacion_huella_repetida(
  p_sha256 text, p_empleado_id uuid, p_excluir uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select case
    when bool_or(d.empleado_id = p_empleado_id) then 'Ese archivo ya está cargado en este legajo (' || min(t.nombre) || ')'
    when count(*) > 0 then 'Ese archivo ya está cargado en el legajo de otra persona. Avisá a Administración'
  end
  from public.documentacion_archivos a
  join public.documentacion_documentos d on d.id = a.documento_id
  join public.documentacion_tipos t on t.codigo = d.tipo
  left join public.documentacion_verificaciones v on v.archivo_id = a.id
  where coalesce(v.sha256, a.sha256) = p_sha256
    and d.id is distinct from p_excluir
    and d.estado not in ('anulado','subiendo')
$fn$;

-- Al quedar vigente uno nuevo de un tipo que no admite varios, el anterior
-- queda reemplazado. Al cargar uno nuevo, los que esperaban también.
create or replace function public.documentacion_reemplazar_anteriores(
  p_documento_id uuid, p_estados text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_doc public.documentacion_documentos%rowtype;
  r record;
begin
  v_doc := (select d from public.documentacion_documentos d where d.id = p_documento_id);
  if (select t.multiple from public.documentacion_tipos t where t.codigo = v_doc.tipo) then
    return;
  end if;
  for r in
    select d.id from public.documentacion_documentos d
    where d.empleado_id = v_doc.empleado_id
      and d.tipo = v_doc.tipo
      and d.id <> v_doc.id
      and d.estado = any (p_estados)
  loop
    update public.documentacion_documentos
       set estado = 'reemplazado', reemplazado_por = v_doc.id, reemplazado_at = now()
     where id = r.id;
    perform public.documentacion_registrar_evento(r.id, 'reemplazado', jsonb_build_object('por', v_doc.id));
  end loop;
end;
$fn$;

revoke all on function public.documentacion_usuario_actual() from public, anon, authenticated;
revoke all on function public.documentacion_cliente() from public, anon, authenticated;
revoke all on function public.documentacion_registrar_evento(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.documentacion_huellas(uuid) from public, anon, authenticated;
revoke all on function public.documentacion_huella_repetida(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.documentacion_reemplazar_anteriores(uuid, text[]) from public, anon, authenticated;

-- ============================================================================
-- 8. RPC: preparar la subida
-- ============================================================================
--
-- p_archivos: [{"mime": "image/jpeg", "bytes": 123456, "sha256": "<64 hex>"}, ...]
-- Devuelve {documento_id, archivos: [{orden, cara, ruta}]}.

create or replace function public.documentacion_preparar(
  p_empleado_id   uuid,
  p_tipo          text,
  p_fecha_emision date,
  p_vence_el      date,
  p_detalle       text,
  p_archivos      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_actor     uuid;
  v_gestiona  boolean;
  v_origen    text;
  v_tipo      public.documentacion_tipos%rowtype;
  v_cant      integer;
  v_doc       uuid;
  v_detalle   text;
  v_vence     date;
  v_res       jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_orden     integer := 0;
  v_mime      text;
  v_bytes     bigint;
  v_sha       text;
  v_shas      text[] := array[]::text[];
  v_repetida  text;
  v_cara      text;
  v_ext       text;
  v_ruta      text;
begin
  if v_uid is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  v_actor := public.documentacion_usuario_actual();
  if v_actor is null then
    raise exception 'Usuario inactivo' using errcode = '42501';
  end if;
  v_gestiona := public.documentacion_puede_gestionar();

  v_tipo := (select t from public.documentacion_tipos t where t.codigo = p_tipo and t.activo);
  if v_tipo.codigo is null then
    raise exception 'Tipo de documento inexistente';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then
    raise exception 'Empleado inexistente';
  end if;

  if v_tipo.sensibilidad = 'reservado_gerencia' and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo carga Gerencia' using errcode = '42501';
  end if;
  if v_gestiona then
    v_origen := 'administracion';
  elsif p_empleado_id = v_actor then
    if not v_tipo.sube_vigilador then
      raise exception 'Este documento lo carga Administración' using errcode = '42501';
    end if;
    perform public.legajo_exigir_habilitado('documentacion');
    v_origen := 'vigilador';
  else
    raise exception 'Sólo podés cargar tu propia documentación' using errcode = '42501';
  end if;

  -- Fecha de emisión
  if v_tipo.campo_fecha = 'obligatoria' and p_fecha_emision is null then
    raise exception 'Falta la fecha (%).', lower(v_tipo.etiqueta_fecha);
  end if;
  if v_tipo.campo_fecha = 'no' and p_fecha_emision is not null then
    raise exception 'Este documento no lleva fecha';
  end if;
  if p_fecha_emision is not null
     and (p_fecha_emision > current_date or p_fecha_emision < date '1950-01-01') then
    raise exception 'La fecha no es válida';
  end if;

  -- Vencimiento
  if v_tipo.campo_vencimiento = 'calculado' then
    if p_vence_el is not null then
      raise exception 'El vencimiento de este documento se calcula solo';
    end if;
    if p_fecha_emision is not null then
      v_vence := (p_fecha_emision + make_interval(months => v_tipo.vigencia_meses))::date;
    end if;
  elsif v_tipo.campo_vencimiento = 'declarado' then
    if p_vence_el is null then
      raise exception 'Falta la fecha de vencimiento que figura en el documento';
    end if;
    if p_vence_el < date '2000-01-01' or p_vence_el > current_date + interval '20 years'
       or (p_fecha_emision is not null and p_vence_el <= p_fecha_emision) then
      raise exception 'La fecha de vencimiento no es válida';
    end if;
    v_vence := p_vence_el;
  elsif p_vence_el is not null then
    raise exception 'Este documento no lleva vencimiento';
  end if;

  -- Detalle
  v_detalle := nullif(btrim(coalesce(p_detalle, '')), '');
  if v_tipo.etiqueta_detalle is not null and v_tipo.multiple and v_detalle is null then
    raise exception 'Falta completar: %', lower(v_tipo.etiqueta_detalle);
  end if;
  if v_detalle is not null and char_length(v_detalle) > 200 then
    raise exception 'El texto es demasiado largo (máximo 200 caracteres)';
  end if;

  -- Archivos
  if p_archivos is null or jsonb_typeof(p_archivos) <> 'array' then
    raise exception 'Faltan los archivos';
  end if;
  v_cant := jsonb_array_length(p_archivos);
  if v_cant < 1 or v_cant > 10 then
    raise exception 'Se pueden subir entre 1 y 10 archivos';
  end if;
  if v_tipo.caras is not null and v_cant <> coalesce(array_length(v_tipo.caras, 1), 0) then
    raise exception 'Faltan fotos: se necesitan % (%).',
      array_length(v_tipo.caras, 1), array_to_string(v_tipo.caras, ' y ');
  end if;
  for v_item in select value from jsonb_array_elements(p_archivos) loop
    v_sha := lower(coalesce(v_item->>'sha256', ''));
    if v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'Falta la huella del archivo. Actualizá la app y probá de nuevo';
    end if;
    if v_sha = any (v_shas) then
      raise exception 'Subiste dos veces el mismo archivo';
    end if;
    v_repetida := public.documentacion_huella_repetida(v_sha, p_empleado_id, null);
    if v_repetida is not null then
      raise exception '%', v_repetida;
    end if;
    v_shas := v_shas || v_sha;
  end loop;

  v_doc := gen_random_uuid();
  insert into public.documentacion_documentos (
    id, empleado_id, tipo, sensibilidad, detalle, fecha_emision, vence_el, origen, estado,
    subido_por, subido_por_auth
  ) values (
    v_doc, p_empleado_id, p_tipo, v_tipo.sensibilidad, v_detalle, p_fecha_emision, v_vence, v_origen, 'subiendo',
    v_actor, v_uid
  );

  for v_item in select value from jsonb_array_elements(p_archivos) loop
    v_orden := v_orden + 1;
    v_mime  := v_item->>'mime';
    v_bytes := (v_item->>'bytes')::bigint;
    if v_mime is null or v_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then
      raise exception 'Formato no admitido: subí una foto (JPG/PNG) o un PDF';
    end if;
    if v_bytes is null or v_bytes <= 0 or v_bytes > 15728640 then
      raise exception 'Cada archivo puede pesar hasta 15 MB';
    end if;
    v_cara := case when v_tipo.caras is not null then v_tipo.caras[v_orden] end;
    v_ext := case v_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png'
                         when 'image/webp' then 'webp' else 'jpg' end;
    -- Sin nombres de persona ni de documento en la ruta.
    v_ruta := p_empleado_id::text || '/' || v_doc::text || '/' || v_orden::text || '.' || v_ext;
    insert into public.documentacion_archivos (documento_id, orden, cara, ruta, mime, bytes, sha256)
    values (v_doc, v_orden, v_cara, v_ruta, v_mime, v_bytes::integer, v_shas[v_orden]);
    v_res := v_res || jsonb_build_object('orden', v_orden, 'cara', v_cara, 'ruta', v_ruta);
  end loop;

  perform public.documentacion_registrar_evento(v_doc, 'preparado',
    jsonb_build_object('origen', v_origen, 'archivos', v_cant));

  return jsonb_build_object('documento_id', v_doc, 'archivos', v_res);
end;
$fn$;

revoke all on function public.documentacion_preparar(uuid, text, date, date, text, jsonb) from public, anon;
grant execute on function public.documentacion_preparar(uuid, text, date, date, text, jsonb) to authenticated;

-- ============================================================================
-- 9. Verificación del servidor (sólo service_role)
-- ============================================================================
--
-- La llama /api/documentacion/confirmar después de descargar el archivo
-- guardado, detectar su tipo real y calcular la huella. Idempotente.

create or replace function public.documentacion_registrar_verificacion(
  p_archivo_id uuid, p_sha256 text, p_mime_real text, p_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_arch public.documentacion_archivos%rowtype;
  v_prev public.documentacion_verificaciones%rowtype;
begin
  v_arch := (select a from public.documentacion_archivos a where a.id = p_archivo_id);
  if v_arch.id is null then
    raise exception 'Archivo inexistente';
  end if;
  v_prev := (select v from public.documentacion_verificaciones v where v.archivo_id = p_archivo_id);
  if v_prev.archivo_id is not null then
    if v_prev.sha256 <> lower(p_sha256) then
      raise exception 'El archivo cambió después de verificado' using errcode = '42501';
    end if;
    return jsonb_build_object('archivo_id', p_archivo_id, 'ya_estaba', true);
  end if;
  insert into public.documentacion_verificaciones (archivo_id, sha256, mime_real, bytes)
  values (p_archivo_id, lower(p_sha256), p_mime_real, p_bytes);
  return jsonb_build_object('archivo_id', p_archivo_id, 'ya_estaba', false);
end;
$fn$;

revoke all on function public.documentacion_registrar_verificacion(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.documentacion_registrar_verificacion(uuid, text, text, integer) to service_role;

-- ============================================================================
-- 10. RPC: confirmar la subida
-- ============================================================================

create or replace function public.documentacion_confirmar(p_documento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_doc       public.documentacion_documentos%rowtype;
  v_falta     integer;
  v_distinto  integer;
  v_repetida  text;
  v_estado    text;
  r           record;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  v_doc := (select d from public.documentacion_documentos d where d.id = p_documento_id);
  if v_doc.id is null or v_doc.subido_por_auth is distinct from auth.uid() then
    raise exception 'Documento inexistente' using errcode = '42501';
  end if;
  if v_doc.estado <> 'subiendo' then
    return jsonb_build_object('documento_id', v_doc.id, 'estado', v_doc.estado);
  end if;

  -- Cada archivo tiene que estar en Storage con el tamaño declarado…
  v_falta := (
    select count(*)
    from public.documentacion_archivos a
    where a.documento_id = v_doc.id
      and not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'legajo-documentos'
          and o.name = a.ruta
          and (o.metadata->>'size')::bigint = a.bytes
      )
  );
  if v_falta > 0 then
    raise exception 'No se terminaron de subir % archivo(s). Probá de nuevo.', v_falta;
  end if;

  -- …y verificado por el servidor: misma huella y mismo tipo real.
  v_falta := (
    select count(*) from public.documentacion_archivos a
    where a.documento_id = v_doc.id
      and not exists (select 1 from public.documentacion_verificaciones v where v.archivo_id = a.id)
  );
  if v_falta > 0 then
    raise exception 'Falta verificar % archivo(s)', v_falta using errcode = '42501';
  end if;
  v_distinto := (
    select count(*) from public.documentacion_archivos a
    join public.documentacion_verificaciones v on v.archivo_id = a.id
    where a.documento_id = v_doc.id
      and (v.sha256 <> a.sha256 or v.mime_real <> a.mime or v.bytes <> a.bytes)
  );
  if v_distinto > 0 then
    perform public.documentacion_registrar_evento(v_doc.id, 'verificacion_fallida', null);
    raise exception 'El archivo guardado no coincide con el que se eligió. Probá de nuevo.';
  end if;

  for r in
    select v.sha256 from public.documentacion_archivos a
    join public.documentacion_verificaciones v on v.archivo_id = a.id
    where a.documento_id = v_doc.id
  loop
    v_repetida := public.documentacion_huella_repetida(r.sha256, v_doc.empleado_id, v_doc.id);
    if v_repetida is not null then
      raise exception '%', v_repetida;
    end if;
  end loop;

  v_estado := case v_doc.origen when 'vigilador' then 'pendiente_revision' else 'pendiente_aceptacion' end;
  -- Lo reservado no espera constancia de la persona: queda vigente.
  if v_doc.sensibilidad = 'reservado_gerencia' then
    v_estado := 'aprobado';
  end if;
  update public.documentacion_documentos
     set estado = v_estado, confirmado_at = now(),
         revisado_por = case when v_estado = 'aprobado' then public.documentacion_usuario_actual() end,
         revisado_at  = case when v_estado = 'aprobado' then now() end
   where id = v_doc.id;

  perform public.documentacion_reemplazar_anteriores(v_doc.id,
    array['pendiente_revision','pendiente_aceptacion','rechazado','observado']
    || case when v_estado = 'aprobado' then array['aprobado','aceptado'] else array[]::text[] end);
  perform public.documentacion_registrar_evento(v_doc.id, 'cargado',
    jsonb_build_object('estado', v_estado, 'huellas', public.documentacion_huellas(v_doc.id)));

  return jsonb_build_object('documento_id', v_doc.id, 'estado', v_estado);
end;
$fn$;

revoke all on function public.documentacion_confirmar(uuid) from public, anon;
grant execute on function public.documentacion_confirmar(uuid) to authenticated;

-- ============================================================================
-- 11. RPC: Administración revisa lo que subió la persona
-- ============================================================================

create or replace function public.documentacion_revisar(
  p_documento_id uuid, p_decision text, p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_doc    public.documentacion_documentos%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_doc := (select d from public.documentacion_documentos d where d.id = p_documento_id);
  if v_doc.id is null or not public.documentacion_puede_ver(v_doc.empleado_id, v_doc.sensibilidad, v_doc.estado) then
    raise exception 'Documento inexistente';
  end if;
  if v_doc.estado <> 'pendiente_revision' then
    raise exception 'Este documento ya no está para revisar';
  end if;

  if p_decision = 'aprobar' then
    update public.documentacion_documentos
       set estado = 'aprobado', revisado_por = public.documentacion_usuario_actual(), revisado_at = now()
     where id = v_doc.id;
    perform public.documentacion_reemplazar_anteriores(v_doc.id, array['aprobado','aceptado']);
    perform public.documentacion_registrar_evento(v_doc.id, 'aprobado', null);
    return jsonb_build_object('estado', 'aprobado');
  elsif p_decision = 'rechazar' then
    if v_motivo is null or char_length(v_motivo) < 3 then
      raise exception 'Escribí el motivo del rechazo: la persona lo va a ver';
    end if;
    update public.documentacion_documentos
       set estado = 'rechazado', revisado_por = public.documentacion_usuario_actual(),
           revisado_at = now(), motivo_rechazo = left(v_motivo, 300)
     where id = v_doc.id;
    perform public.documentacion_registrar_evento(v_doc.id, 'rechazado', jsonb_build_object('motivo', left(v_motivo, 300)));
    return jsonb_build_object('estado', 'rechazado');
  end if;
  raise exception 'Decisión inválida';
end;
$fn$;

revoke all on function public.documentacion_revisar(uuid, text, text) from public, anon;
grant execute on function public.documentacion_revisar(uuid, text, text) to authenticated;

-- ============================================================================
-- 12. RPC: la persona deja su constancia (o avisa que hay un error)
-- ============================================================================
--
-- p_decision: la constancia del tipo ('conformidad' | 'recepcion' |
-- 'toma_conocimiento') u 'observacion' (sólo donde hay conformidad). Exige
-- haber abierto el documento antes (constancia de lectura), como el Estatuto.

create or replace function public.documentacion_responder(
  p_documento_id uuid, p_decision text, p_comentario text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_doc        public.documentacion_documentos%rowtype;
  v_tipo       public.documentacion_tipos%rowtype;
  v_actor      uuid;
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_ip         text;
  v_ua         text;
  v_estado     text;
begin
  v_actor := public.documentacion_usuario_actual();
  if v_actor is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  v_doc := (select d from public.documentacion_documentos d where d.id = p_documento_id);
  -- Sólo la persona del legajo responde. Nadie deja constancia por otro.
  if v_doc.id is null or v_doc.empleado_id <> v_actor then
    raise exception 'Documento inexistente' using errcode = '42501';
  end if;
  if v_doc.estado <> 'pendiente_aceptacion' then
    raise exception 'Este documento ya no está para responder';
  end if;
  perform public.legajo_exigir_habilitado('documentacion');
  v_tipo := (select t from public.documentacion_tipos t where t.codigo = v_doc.tipo);
  if v_comentario is not null and char_length(v_comentario) > 500 then
    raise exception 'El comentario es demasiado largo (máximo 500 caracteres)';
  end if;
  if not exists (select 1 from public.documentacion_constancias c
                 where c.documento_id = v_doc.id and c.tipo = 'lectura') then
    raise exception 'Abrí el documento antes de responder';
  end if;

  if p_decision = 'observacion' then
    if v_tipo.constancia <> 'conformidad' then
      raise exception 'En este documento sólo se toma conocimiento o se confirma la recepción; podés dejar un comentario';
    end if;
    if v_comentario is null or char_length(v_comentario) < 3 then
      raise exception 'Contanos qué está mal';
    end if;
    v_estado := 'observado';
  elsif p_decision = v_tipo.constancia then
    v_estado := 'aceptado';
  else
    raise exception 'Decisión inválida';
  end if;

  v_ip := (select c.ip from public.documentacion_cliente() c);
  v_ua := (select c.user_agent from public.documentacion_cliente() c);

  insert into public.documentacion_constancias (
    documento_id, empleado_id, auth_user_id, tipo, texto, comentario, archivos_sha256, ip, user_agent
  ) values (
    v_doc.id, v_actor, auth.uid(), p_decision,
    case when p_decision = 'observacion' then null else v_tipo.texto_constancia end,
    v_comentario, public.documentacion_huellas(v_doc.id), v_ip, v_ua
  );

  update public.documentacion_documentos
     set estado = v_estado, respondido_at = now(), respuesta = p_decision,
         respuesta_comentario = v_comentario
   where id = v_doc.id;
  if v_estado = 'aceptado' then
    perform public.documentacion_reemplazar_anteriores(v_doc.id, array['aprobado','aceptado']);
  end if;
  perform public.documentacion_registrar_evento(v_doc.id, p_decision, jsonb_build_object('comentario', v_comentario));
  return jsonb_build_object('estado', v_estado);
end;
$fn$;

revoke all on function public.documentacion_responder(uuid, text, text) from public, anon;
grant execute on function public.documentacion_responder(uuid, text, text) to authenticated;

-- ============================================================================
-- 13. Abrir un archivo (sólo service_role, desde /api/documentacion/archivo)
-- ============================================================================
--
-- El servidor verificó el token y pasa la identidad. Se fija en la sesión
-- (`request.jwt.claim.sub`, local a la transacción) para que todas las
-- funciones de permiso usen la misma regla que con el usuario directo.
-- Controla el permiso, registra el acceso (y la lectura, si es la persona) y
-- devuelve la ruta que el servidor firma por 60 segundos.

create or replace function public.documentacion_abrir(
  p_auth_user_id uuid, p_archivo_id uuid, p_modo text, p_ip text, p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_arch   public.documentacion_archivos%rowtype;
  v_doc    public.documentacion_documentos%rowtype;
  v_actor  uuid;
begin
  if p_auth_user_id is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_auth_user_id, 'role', 'authenticated')::text, true);

  v_actor := public.documentacion_usuario_actual();
  if v_actor is null then
    raise exception 'Usuario inactivo' using errcode = '42501';
  end if;
  if p_modo not in ('ver','descargar') then
    raise exception 'Modo inválido';
  end if;
  v_arch := (select a from public.documentacion_archivos a where a.id = p_archivo_id);
  v_doc := (select d from public.documentacion_documentos d where d.id = v_arch.documento_id);
  if v_arch.id is null or v_doc.id is null or v_doc.estado = 'subiendo'
     or not public.documentacion_puede_ver(v_doc.empleado_id, v_doc.sensibilidad, v_doc.estado) then
    raise exception 'Archivo inexistente' using errcode = '42501';
  end if;
  perform public.legajo_exigir_habilitado('documentacion');
  if p_modo = 'descargar' and not public.documentacion_puede_gestionar() then
    raise exception 'La descarga es sólo para Administración y Gerencia' using errcode = '42501';
  end if;

  insert into public.documentacion_accesos (archivo_id, documento_id, empleado_id, usuario_id, auth_user_id, modo, ip, user_agent)
  values (v_arch.id, v_doc.id, v_doc.empleado_id, v_actor, p_auth_user_id, p_modo, left(p_ip, 200), left(p_user_agent, 400));

  if v_doc.empleado_id = v_actor and v_doc.estado = 'pendiente_aceptacion' then
    insert into public.documentacion_constancias (documento_id, empleado_id, auth_user_id, tipo, archivos_sha256, ip, user_agent)
    values (v_doc.id, v_actor, p_auth_user_id, 'lectura', public.documentacion_huellas(v_doc.id), left(p_ip, 200), left(p_user_agent, 400))
    on conflict (documento_id) where tipo = 'lectura' do nothing;
  end if;

  return jsonb_build_object('ruta', v_arch.ruta, 'mime', v_arch.mime, 'orden', v_arch.orden,
                            'tipo', v_doc.tipo, 'documento_id', v_doc.id);
end;
$fn$;

revoke all on function public.documentacion_abrir(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.documentacion_abrir(uuid, uuid, text, text, text) to service_role;

-- ============================================================================
-- 14. RPC: anular (carga equivocada). El archivo queda guardado.
-- ============================================================================

create or replace function public.documentacion_anular(p_documento_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_doc    public.documentacion_documentos%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_doc := (select d from public.documentacion_documentos d where d.id = p_documento_id);
  if v_doc.id is null or not public.documentacion_puede_ver(v_doc.empleado_id, v_doc.sensibilidad, v_doc.estado) then
    raise exception 'Documento inexistente';
  end if;
  if v_doc.estado in ('anulado','reemplazado','subiendo') then
    raise exception 'Este documento no se puede anular';
  end if;
  if v_motivo is null or char_length(v_motivo) < 3 then
    raise exception 'Escribí el motivo';
  end if;
  update public.documentacion_documentos
     set estado = 'anulado', anulado_por = public.documentacion_usuario_actual(),
         anulado_at = now(), motivo_anulacion = left(v_motivo, 300)
   where id = v_doc.id;
  perform public.documentacion_registrar_evento(v_doc.id, 'anulado', jsonb_build_object('motivo', left(v_motivo, 300)));
  return jsonb_build_object('estado', 'anulado');
end;
$fn$;

revoke all on function public.documentacion_anular(uuid, text) from public, anon;
grant execute on function public.documentacion_anular(uuid, text) to authenticated;

-- ============================================================================
-- 15. RPC: "no corresponde" / "solicitado" / sin efecto
-- ============================================================================

create or replace function public.documentacion_marcar_situacion(
  p_empleado_id uuid, p_tipo text, p_situacion text, p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_tipo   public.documentacion_tipos%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_tipo := (select t from public.documentacion_tipos t where t.codigo = p_tipo and t.activo);
  if v_tipo.codigo is null then
    raise exception 'Tipo de documento inexistente';
  end if;
  if v_tipo.sensibilidad = 'reservado_gerencia' and not public.documentacion_es_gerencia() then
    raise exception 'Este documento lo maneja Gerencia' using errcode = '42501';
  end if;
  if not exists (select 1 from public.usuarios u where u.id = p_empleado_id) then
    raise exception 'Empleado inexistente';
  end if;
  if p_situacion not in ('no_corresponde','solicitado','sin_efecto') then
    raise exception 'Situación inválida';
  end if;
  if p_situacion = 'no_corresponde' and (v_motivo is null or char_length(v_motivo) < 3) then
    raise exception 'Escribí por qué no corresponde';
  end if;
  if v_motivo is not null and char_length(v_motivo) > 300 then
    raise exception 'El motivo es demasiado largo (máximo 300 caracteres)';
  end if;
  insert into public.documentacion_situaciones (empleado_id, tipo, situacion, motivo, usuario_id)
  values (p_empleado_id, p_tipo, p_situacion, v_motivo, public.documentacion_usuario_actual());
  return jsonb_build_object('situacion', p_situacion);
end;
$fn$;

revoke all on function public.documentacion_marcar_situacion(uuid, text, text, text) from public, anon;
grant execute on function public.documentacion_marcar_situacion(uuid, text, text, text) to authenticated;

-- ============================================================================
-- 16. RPC: documentación de una persona (legajo)
-- ============================================================================
--
-- Un solo jsonb. Las referencias de Liquidación se leen acá (SECURITY DEFINER)
-- y sólo devuelven fechas y referencias: nunca importes ni datos bancarios.

create or replace function public.documentacion_de_empleado(p_empleado_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_actor    uuid;
  v_gestiona boolean;
  v_gerencia boolean;
  v_propio   boolean;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida' using errcode = '42501';
  end if;
  v_actor := public.documentacion_usuario_actual();
  v_gestiona := public.documentacion_puede_gestionar();
  v_gerencia := public.documentacion_es_gerencia();
  v_propio := v_actor is not null and v_actor = p_empleado_id;
  if not (v_gestiona or v_propio) then
    raise exception 'La documentación del legajo la consultan la persona, Administración y Gerencia'
      using errcode = '42501';
  end if;
  perform public.legajo_exigir_habilitado('documentacion');

  return jsonb_build_object(
    'empleado_id', p_empleado_id,
    'es_propio', v_propio,
    'puede_gestionar', v_gestiona,
    'es_gerencia', v_gerencia,
    'hoy', current_date,
    'tipos', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.orden), '[]'::jsonb)
      from public.documentacion_tipos t
      where t.activo and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)
    ),
    'situaciones', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'tipo', s.tipo, 'situacion', s.situacion, 'motivo', s.motivo, 'at', s.at)), '[]'::jsonb)
      from (
        select distinct on (s.tipo) s.*
        from public.documentacion_situaciones s
        join public.documentacion_tipos t on t.codigo = s.tipo
        where s.empleado_id = p_empleado_id
          and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)
        order by s.tipo, s.id desc
      ) s
      where s.situacion <> 'sin_efecto'
    ),
    'documentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'tipo', d.tipo, 'detalle', d.detalle, 'sensibilidad', d.sensibilidad,
          'fecha_emision', d.fecha_emision, 'vence_el', d.vence_el,
          'origen', d.origen, 'estado', d.estado,
          'creado_at', d.creado_at, 'confirmado_at', d.confirmado_at,
          'subido_por_nombre', nullif(trim(coalesce(us.nombre, '') || ' ' || coalesce(us.apellido, '')), ''),
          'revisado_at', d.revisado_at,
          'revisado_por_nombre', nullif(trim(coalesce(ur.nombre, '') || ' ' || coalesce(ur.apellido, '')), ''),
          'motivo_rechazo', d.motivo_rechazo,
          'respondido_at', d.respondido_at,
          'respuesta', d.respuesta,
          'respuesta_comentario', d.respuesta_comentario,
          'reemplazado_at', d.reemplazado_at,
          'anulado_at', d.anulado_at,
          'motivo_anulacion', d.motivo_anulacion,
          'leido', exists (select 1 from public.documentacion_constancias c where c.documento_id = d.id and c.tipo = 'lectura'),
          'constancias', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'tipo', c.tipo, 'texto', c.texto, 'comentario', c.comentario, 'at', c.at)
                order by c.at), '[]'::jsonb)
            from public.documentacion_constancias c where c.documento_id = d.id
          ),
          'archivos', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'id', a.id, 'orden', a.orden, 'cara', a.cara,
                'mime', a.mime, 'bytes', a.bytes) order by a.orden), '[]'::jsonb)
            from public.documentacion_archivos a where a.documento_id = d.id
          )
        ) order by d.creado_at desc), '[]'::jsonb)
      from public.documentacion_documentos d
      left join public.usuarios us on us.id = d.subido_por
      left join public.usuarios ur on ur.id = d.revisado_por
      where d.empleado_id = p_empleado_id
        and d.estado <> 'subiendo'
        and public.documentacion_puede_ver(d.empleado_id, d.sensibilidad, d.estado)
    ),
    -- Quién abrió qué: sólo Administración y Gerencia, los últimos 200.
    'accesos', case when v_gestiona then (
      select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'at', ac.at, 'modo', ac.modo, 'tipo', d.tipo, 'orden', a.orden,
                 'quien', nullif(trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')), '')) j,
               ac.at
        from public.documentacion_accesos ac
        join public.documentacion_documentos d on d.id = ac.documento_id
        join public.documentacion_archivos a on a.id = ac.archivo_id
        left join public.usuarios u on u.id = ac.usuario_id
        where ac.empleado_id = p_empleado_id
          and public.documentacion_puede_ver(d.empleado_id, d.sensibilidad, d.estado)
        order by ac.at desc
        limit 200
      ) x
    ) end,
    'referencias', jsonb_build_object(
      'sindicato', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'desde', p.vigencia_desde, 'hasta', p.vigencia_hasta) order by p.vigencia_desde), '[]'::jsonb)
        from public.liquidacion_concepto_permanente p
        join public.liquidacion_concepto_catalogo c on c.id = p.concepto_id
        left join public.liquidacion_persona lp on lp.id = p.persona_id
        where c.codigo_visual = '104' and p.activo
          and (p.vigencia_hasta is null or p.vigencia_hasta >= current_date)
          and coalesce(p.empleado_id, lp.usuario_id) = p_empleado_id
      ),
      'embargos', (
        select coalesce(jsonb_agg(x.e order by x.desde), '[]'::jsonb)
        from (
          select jsonb_build_object('origen', 'expediente', 'referencia', e.referencia,
                   'desde', e.vigencia_desde, 'hasta', e.vigencia_hasta) as e,
                 e.vigencia_desde as desde
          from public.liquidacion_expediente e
          join public.liquidacion_persona lp on lp.id = e.persona_id
          where e.estado = 'activo' and lp.usuario_id = p_empleado_id
            and (e.vigencia_hasta is null or e.vigencia_hasta >= current_date)
          union all
          select jsonb_build_object('origen', 'concepto', 'referencia', c.nombre,
                   'desde', p.vigencia_desde, 'hasta', p.vigencia_hasta),
                 p.vigencia_desde
          from public.liquidacion_concepto_permanente p
          join public.liquidacion_concepto_catalogo c on c.id = p.concepto_id
          left join public.liquidacion_persona lp on lp.id = p.persona_id
          where c.codigo_visual in ('48410','5580','993') and p.activo
            and (p.vigencia_hasta is null or p.vigencia_hasta >= current_date)
            and coalesce(p.empleado_id, lp.usuario_id) = p_empleado_id
        ) x
      ),
      'suspensiones', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'desde', n.fecha_desde, 'hasta', n.fecha_hasta, 'observacion', n.observacion)
            order by n.fecha_desde desc), '[]'::jsonb)
        from public.novedades_laborales n
        where n.empleado_id = p_empleado_id and n.tipo = 'suspension' and n.estado = 'aprobada'
      )
    )
  );
end;
$fn$;

revoke all on function public.documentacion_de_empleado(uuid) from public, anon;
grant execute on function public.documentacion_de_empleado(uuid) to authenticated;

-- ============================================================================
-- 17. RPC: control de Administración
-- ============================================================================
--
-- Un jsonb (PostgREST corta en 1000 filas sin avisar): personas activas sin
-- cuentas de prueba, con sus documentos en juego y sus situaciones. El cálculo
-- de faltantes/vencidos lo hace lib/documentacion.ts con la misma regla que el
-- legajo.

create or replace function public.documentacion_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_gerencia boolean;
begin
  if not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  v_gerencia := public.documentacion_es_gerencia();

  return jsonb_build_object(
    'hoy', current_date,
    'tipos', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.orden), '[]'::jsonb)
      from public.documentacion_tipos t
      where t.activo and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)
    ),
    'personas', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'empleado_id', u.id, 'nombre', u.nombre, 'apellido', u.apellido,
          'legajo', u.legajo, 'rol', u.rol, 'puesto', u.puesto_organizacional,
          'situaciones', (
            select coalesce(jsonb_agg(jsonb_build_object('tipo', s.tipo, 'situacion', s.situacion, 'motivo', s.motivo)), '[]'::jsonb)
            from (
              select distinct on (s.tipo) s.*
              from public.documentacion_situaciones s
              join public.documentacion_tipos t on t.codigo = s.tipo
              where s.empleado_id = u.id and (t.sensibilidad <> 'reservado_gerencia' or v_gerencia)
              order by s.tipo, s.id desc
            ) s where s.situacion <> 'sin_efecto'
          ),
          'documentos', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'id', d.id, 'tipo', d.tipo, 'estado', d.estado, 'origen', d.origen,
                'detalle', d.detalle, 'vence_el', d.vence_el, 'sensibilidad', d.sensibilidad,
                'confirmado_at', d.confirmado_at,
                'respuesta_comentario', d.respuesta_comentario,
                'fecha_emision', d.fecha_emision,
                -- Los archivos, sólo de lo que hay que revisar: se aprueba
                -- desde la bandeja sin abrir legajo por legajo.
                'archivos', case when d.estado = 'pendiente_revision' then (
                  select coalesce(jsonb_agg(jsonb_build_object(
                      'id', a.id, 'orden', a.orden, 'cara', a.cara,
                      'mime', a.mime, 'bytes', a.bytes) order by a.orden), '[]'::jsonb)
                  from public.documentacion_archivos a where a.documento_id = d.id
                ) end) order by d.confirmado_at), '[]'::jsonb)
            from public.documentacion_documentos d
            where d.empleado_id = u.id
              and d.estado not in ('subiendo','reemplazado','anulado')
              and (d.sensibilidad <> 'reservado_gerencia' or v_gerencia)
          )
        ) order by u.apellido, u.nombre), '[]'::jsonb)
      from public.usuarios u
      where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
    )
  );
end;
$fn$;

revoke all on function public.documentacion_control() from public, anon;
grant execute on function public.documentacion_control() to authenticated;

-- ============================================================================
-- 18. CATÁLOGO INICIAL
-- ============================================================================
-- Textos de constancia: lo que la persona declara. En sanciones, cartas
-- documento y embargos sólo se toma conocimiento (no implica conformidad).

insert into public.documentacion_tipos (
  codigo, nombre, ayuda, orden, requisito, etapa, caras, multiple, campo_fecha, etiqueta_fecha,
  campo_vencimiento, vigencia_meses, etiqueta_detalle, sube_vigilador, sensibilidad, constancia,
  texto_constancia, referencia, activo
) values
  ('dni', 'DNI', 'Foto del frente y del dorso.', 10, 'obligatorio', 'ingreso',
   array['Frente','Dorso'], false, 'no', 'Fecha de emisión', 'no', null, null, true, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('cuil', 'Constancia de CUIL', null, 20, 'obligatorio', 'ingreso',
   null, false, 'no', 'Fecha de emisión', 'no', null, null, true, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('domicilio', 'Declaración jurada de domicilio', null, 30, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha de la declaración', 'no', null, null, true, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('antecedentes_provincia', 'Certificado de antecedentes penales (Provincia de Santa Fe)', null, 40, 'obligatorio', 'ingreso',
   null, false, 'obligatoria', 'Fecha de emisión', 'no', null, null, true, 'sensible', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('antecedentes_rnr', 'Certificado de antecedentes RNR (nacional)', 'Se renueva cada 6 meses.', 50, 'obligatorio', 'permanencia',
   null, false, 'obligatoria', 'Fecha de emisión', 'calculado', 6, null, true, 'sensible', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('credencial', 'Credencial de vigilador', 'Foto del frente y del dorso, con la fecha de vencimiento.', 60, 'obligatorio', 'permanencia',
   array['Frente','Dorso'], false, 'opcional', 'Fecha de emisión', 'declarado', null, null, true, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('acta_credencial', 'Acta de entrega de credencial', null, 70, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha de entrega', 'no', null, null, false, 'comun', 'recepcion',
   'Confirmo que recibí la credencial y que el acta es correcta.', null, true),
  ('estudios_medicos', 'Estudios médicos', 'Podés subir varias páginas.', 80, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha de los estudios', 'no', null, null, true, 'sensible', 'conformidad',
   'Confirmo que estos estudios son míos.', null, true),
  ('alta_arca', 'Alta ARCA', null, 90, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha de alta', 'no', null, null, false, 'comun', 'conformidad',
   'Tomé conocimiento de mi alta en ARCA y los datos son correctos.', null, true),
  ('codem', 'CODEM (obra social)', null, 100, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha de emisión', 'no', null, null, true, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('secundario', 'Certificado de estudios secundarios', 'Si lo tenés.', 110, 'opcional', 'ingreso',
   null, false, 'no', 'Fecha de emisión', 'no', null, null, true, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, true),
  ('cursos', 'Certificados de cursos', 'Si hiciste alguno. Uno por curso.', 120, 'opcional', 'permanencia',
   null, true, 'opcional', 'Fecha del certificado', 'no', null, 'Nombre del curso', true, 'comun', 'conformidad',
   'Confirmo que este certificado es mío.', null, true),
  ('sindicato', 'Afiliación al sindicato', 'Si estás afiliado.', 130, 'si_corresponde', 'permanencia',
   null, false, 'opcional', 'Fecha de afiliación', 'no', null, null, true, 'comun', 'conformidad',
   'Confirmo que estoy afiliado al sindicato.', 'sindicato', true),
  ('embargos', 'Embargos', 'Oficio judicial, si hay.', 140, 'si_corresponde', 'permanencia',
   null, true, 'opcional', 'Fecha del oficio', 'no', null, 'Juzgado / referencia', false, 'sensible', 'toma_conocimiento',
   'Tomé conocimiento de este documento.', 'embargos', true),
  ('sanciones', 'Sanciones', 'Si hubo alguna.', 150, 'si_corresponde', 'legal',
   null, true, 'obligatoria', 'Fecha de la sanción', 'no', null, 'Motivo', false, 'sensible', 'toma_conocimiento',
   'Tomé conocimiento de este documento. Tomar conocimiento no implica estar de acuerdo.', 'suspensiones', true),
  ('cartas_documento', 'Cartas documento', 'Si hubo alguna.', 160, 'si_corresponde', 'legal',
   null, true, 'obligatoria', 'Fecha de la carta', 'no', null, 'Asunto', false, 'sensible', 'toma_conocimiento',
   'Tomé conocimiento de este documento. Tomar conocimiento no implica estar de acuerdo.', null, true),
  ('baja_arca', 'Baja ARCA', 'Cuando corresponda.', 170, 'si_corresponde', 'egreso',
   null, false, 'opcional', 'Fecha de baja', 'no', null, null, false, 'comun', 'conformidad',
   'Tomé conocimiento de mi baja en ARCA y los datos son correctos.', null, true),
  -- Reservado a Gerencia: la persona no lo ve ni deja constancia.
  ('actuaciones_legales', 'Actuaciones legales (cédulas, audiencias, conciliaciones)', 'Sólo Gerencia.', 180, 'si_corresponde', 'legal',
   null, true, 'obligatoria', 'Fecha', 'no', null, 'Expediente / referencia', false, 'reservado_gerencia', 'ninguna',
   null, null, true),
  -- Adicionales de la decisión H-9: cargados pero INACTIVOS hasta que se aprueben.
  ('solicitud_empleo', 'Solicitud de empleo', null, 200, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha', 'no', null, null, false, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, false),
  ('alta_art', 'Alta ART', null, 210, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha de alta', 'no', null, null, false, 'comun', 'conformidad',
   'Tomé conocimiento de mi alta en la ART y los datos son correctos.', null, false),
  ('svo', 'Seguro de vida obligatorio (SVO)', null, 220, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha', 'no', null, null, false, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, false),
  ('art51', 'Art. 51 / Anexo III (trámite de credencial)', null, 230, 'obligatorio', 'ingreso',
   null, false, 'opcional', 'Fecha', 'no', null, null, false, 'comun', 'conformidad',
   'Confirmo que este documento es mío y que sus datos son correctos.', null, false),
  ('entrega_epp', 'Entrega de EPP / uniforme', 'Uno por entrega.', 240, 'si_corresponde', 'permanencia',
   null, true, 'obligatoria', 'Fecha de entrega', 'no', null, 'Qué se entregó', false, 'comun', 'recepcion',
   'Confirmo que recibí lo que figura en este documento.', null, false)
on conflict (codigo) do nothing;

notify pgrst, 'reload schema';

commit;
