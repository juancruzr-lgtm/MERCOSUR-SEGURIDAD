-- Estatuto Interno: versiones, apertura y aceptación expresa por versión.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- La Gerencia pide que cada integrante pueda leer el Estatuto Interno desde el
-- celular y declarar expresamente que tomó conocimiento de una versión
-- determinada, y que Administración/Gerencia puedan ver quién lo hizo y quién no.
--
-- ── Por qué tablas nuevas y no `lecturas_evaluacion` ─────────────────────────
-- `lecturas_evaluacion` acredita ACCESO a una evaluación mensual (FK a
-- `evaluaciones_mensuales`, una fila por período): es otra cosa. Acá el hecho
-- registrado es una DECLARACIÓN expresa sobre un documento identificado por su
-- hash. Se copia el patrón —tabla de auditoría sin policies de escritura, RPC
-- SECURITY DEFINER que toma la identidad de auth.uid(), unique para que sea
-- idempotente, auth_user_id aparte del empleado— pero no la tabla. Lo mismo con
-- `aceptaciones_planilla`, que es por turno y guarda un snapshot de horas.
--
-- ── Tres tablas ──────────────────────────────────────────────────────────────
--   estatuto_versiones     qué documento, con qué hash, borrador o publicado
--   estatuto_aperturas     la persona abrió el texto de esa versión (primera vez)
--   estatuto_aceptaciones  la constancia: declaró haberlo leído
--
-- La apertura existe porque la Gerencia pidió que la declaración se habilite
-- recién después de abrir el documento. El cliente lo controla en pantalla,
-- pero un control de pantalla se saltea con una llamada directa a la RPC: por
-- eso `estatuto_aceptar` exige que exista la apertura de ESA versión.
--
-- ── Inmutabilidad ────────────────────────────────────────────────────────────
-- Una constancia que se puede editar o borrar no prueba nada. Las aperturas y
-- aceptaciones no tienen UPDATE ni DELETE para nadie: se revocan los permisos
-- (los DEFAULT PRIVILEGES del proyecto conceden INSERT/UPDATE/DELETE/TRUNCATE a
-- authenticated en toda tabla nueva) y además un trigger lo rechaza aunque
-- quien lo intente sea service_role desde el editor. Las FK a usuarios son
-- RESTRICT: dar de baja a alguien no puede llevarse su constancia.
--
-- Una versión publicada, o que ya tiene aceptaciones, tampoco puede cambiar su
-- documento: si el hash cambiara, las constancias dirían que alguien aceptó un
-- texto que no es el que leyó. Un documento nuevo es una versión nueva.
--
-- ── Publicar ─────────────────────────────────────────────────────────────────
-- Sólo Gerencia (`puede_acceder_gerencia_actual()`, que incluye la delegación
-- gerencial vigente), por RPC. La versión 21/04/2026 se carga como BORRADOR: no
-- se publica en esta migración. Mientras no haya ninguna versión publicada, el
-- cartel no aparece para nadie.
--
-- ── Quién ve qué ─────────────────────────────────────────────────────────────
-- Cada persona ve sus propias aperturas y constancias. El control nominal
-- (quién aceptó, quién no) es documentación laboral: Administración y Gerencia
-- (`puede_gestionar_personal_actual()` / `puede_acceder_gerencia_actual()`).
-- Supervisión NO: un supervisor no tiene por qué recorrer la documentación
-- laboral de toda la empresa, y el repo no tiene hoy otra regla para eso.
--
-- ── Reglas SQL del proyecto ──────────────────────────────────────────────────
-- Nada de `select col into variable` (el editor de Supabase lo lee como SELECT
-- INTO que crea tabla): se asigna con `v := (select ...)`. El rollback va en
-- supabase/rollback/20261008150000_estatuto_interno_rollback.sql.

begin;

-- ============================================================================
-- 1. VERSIONES
-- ============================================================================

create table if not exists public.estatuto_versiones (
  id               uuid primary key default gen_random_uuid(),
  -- Identificador estable y legible: la fecha del documento ('2026-04-21').
  identificador    text not null unique check (length(btrim(identificador)) > 0),
  titulo           text not null default 'Estatuto Interno — Mercosur Seguridad SRL',
  -- La fecha que figura en la declaración ("versión 21/04/2026").
  fecha_documento  date not null,
  -- El ORIGINAL tal cual se recibió (Word 97). La ruta es pública dentro de la
  -- app (/public) y el hash es lo que ata la constancia a ese archivo exacto.
  archivo_ruta     text not null,
  archivo_nombre   text not null,
  archivo_sha256   text not null check (archivo_sha256 ~ '^[0-9a-f]{64}$'),
  archivo_bytes    integer not null check (archivo_bytes > 0),
  -- Hash del texto que la app muestra en pantalla (conversión verificada del
  -- original). Permite saber si el texto empaquetado en la app es el mismo que
  -- se cargó con esta versión.
  texto_sha256     text check (texto_sha256 is null or texto_sha256 ~ '^[0-9a-f]{64}$'),
  estado           text not null default 'borrador' check (estado in ('borrador', 'publicado')),
  publicado_at     timestamptz,
  publicado_por    uuid references public.usuarios(id) on delete restrict,
  creado_at        timestamptz not null default now(),
  notas            text,
  constraint estatuto_version_publicada_completa check (
    (estado = 'borrador' and publicado_at is null and publicado_por is null)
    or (estado = 'publicado' and publicado_at is not null)
  )
);

comment on table public.estatuto_versiones is
  'Versiones del Estatuto Interno. La vigente es la publicada mas reciente. '
  'Una version publicada o con aceptaciones no puede cambiar su documento.';

-- ============================================================================
-- 2. APERTURAS
-- ============================================================================

create table if not exists public.estatuto_aperturas (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.estatuto_versiones(id) on delete restrict,
  empleado_id   uuid not null references public.usuarios(id) on delete restrict,
  auth_user_id  uuid not null,
  abierto_at    timestamptz not null default now(),
  -- Idempotencia: abrirlo diez veces es una sola apertura, la primera.
  constraint estatuto_apertura_unica unique (version_id, empleado_id)
);

comment on table public.estatuto_aperturas is
  'Primera vez que una persona abrio el texto de una version publicada del '
  'Estatuto. Acredita acceso, NO aceptacion. Inmutable.';

-- ============================================================================
-- 3. ACEPTACIONES (constancias)
-- ============================================================================

create table if not exists public.estatuto_aceptaciones (
  id                    uuid primary key default gen_random_uuid(),
  version_id            uuid not null references public.estatuto_versiones(id) on delete restrict,
  empleado_id           uuid not null references public.usuarios(id) on delete restrict,
  -- La sesión que aceptó, aparte del empleado: si mañana la persona cambia de
  -- cuenta, la constancia sigue diciendo quién estaba adentro.
  auth_user_id          uuid not null,
  -- Copia de lo aceptado: aunque la tabla de versiones no deja cambiar el
  -- documento, la constancia se sostiene sola.
  version_identificador text not null,
  fecha_documento       date not null,
  archivo_sha256        text not null check (archivo_sha256 ~ '^[0-9a-f]{64}$'),
  texto_sha256          text,
  -- El texto exacto de la declaración, armado en el servidor.
  declaracion           text not null,
  abierto_at            timestamptz not null,
  aceptado_at           timestamptz not null default now(),
  -- Una aceptación por persona y versión.
  constraint estatuto_aceptacion_unica unique (version_id, empleado_id)
);

create index if not exists idx_estatuto_aceptaciones_empleado
  on public.estatuto_aceptaciones (empleado_id, aceptado_at desc);

comment on table public.estatuto_aceptaciones is
  'Constancia digital de que la persona declaro haber leido y tomado '
  'conocimiento de una version del Estatuto Interno. Inmutable. NO reemplaza '
  'las constancias en papel.';

-- ============================================================================
-- 4. INMUTABILIDAD
-- ============================================================================

-- Aperturas y aceptaciones: ni UPDATE ni DELETE ni TRUNCATE, para nadie.
create or replace function public.estatuto_registro_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  raise exception 'Las constancias del Estatuto Interno son inmutables (% en %)', tg_op, tg_table_name
    using errcode = '42501';
end;
$fn$;

drop trigger if exists trg_estatuto_aperturas_inmutable on public.estatuto_aperturas;
create trigger trg_estatuto_aperturas_inmutable
  before update or delete on public.estatuto_aperturas
  for each row execute function public.estatuto_registro_inmutable();

drop trigger if exists trg_estatuto_aperturas_sin_truncate on public.estatuto_aperturas;
create trigger trg_estatuto_aperturas_sin_truncate
  before truncate on public.estatuto_aperturas
  for each statement execute function public.estatuto_registro_inmutable();

drop trigger if exists trg_estatuto_aceptaciones_inmutable on public.estatuto_aceptaciones;
create trigger trg_estatuto_aceptaciones_inmutable
  before update or delete on public.estatuto_aceptaciones
  for each row execute function public.estatuto_registro_inmutable();

drop trigger if exists trg_estatuto_aceptaciones_sin_truncate on public.estatuto_aceptaciones;
create trigger trg_estatuto_aceptaciones_sin_truncate
  before truncate on public.estatuto_aceptaciones
  for each statement execute function public.estatuto_registro_inmutable();

-- Versiones: el documento de una versión publicada o con aceptaciones no cambia,
-- una publicada no vuelve a borrador, y no se borra nada que ya tenga rastro.
create or replace function public.estatuto_version_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_con_rastro boolean;
begin
  v_con_rastro := (
    old.estado = 'publicado'
    or exists (select 1 from public.estatuto_aceptaciones a where a.version_id = old.id)
    or exists (select 1 from public.estatuto_aperturas p where p.version_id = old.id)
  );

  if tg_op = 'DELETE' then
    if v_con_rastro then
      raise exception 'No se puede borrar una version del Estatuto publicada o con aperturas/aceptaciones'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.estado = 'publicado' and new.estado <> 'publicado' then
    raise exception 'Una version publicada del Estatuto no vuelve a borrador'
      using errcode = '42501';
  end if;

  if v_con_rastro and (
       new.identificador   is distinct from old.identificador
    or new.fecha_documento is distinct from old.fecha_documento
    or new.archivo_ruta    is distinct from old.archivo_ruta
    or new.archivo_nombre  is distinct from old.archivo_nombre
    or new.archivo_sha256  is distinct from old.archivo_sha256
    or new.archivo_bytes   is distinct from old.archivo_bytes
    or new.texto_sha256    is distinct from old.texto_sha256
    or new.titulo          is distinct from old.titulo
    or (old.estado = 'publicado' and (
          new.publicado_at  is distinct from old.publicado_at
       or new.publicado_por is distinct from old.publicado_por))
  ) then
    raise exception 'El documento de una version publicada o con aceptaciones no se puede modificar: cargar una version nueva'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_estatuto_version_proteger on public.estatuto_versiones;
create trigger trg_estatuto_version_proteger
  before update or delete on public.estatuto_versiones
  for each row execute function public.estatuto_version_proteger();

drop trigger if exists trg_estatuto_versiones_sin_truncate on public.estatuto_versiones;
create trigger trg_estatuto_versiones_sin_truncate
  before truncate on public.estatuto_versiones
  for each statement execute function public.estatuto_registro_inmutable();

-- ============================================================================
-- 5. PERMISOS Y RLS
-- ============================================================================

alter table public.estatuto_versiones    enable row level security;
alter table public.estatuto_aperturas    enable row level security;
alter table public.estatuto_aceptaciones enable row level security;

-- Los DEFAULT PRIVILEGES conceden de más: se revoca todo y se da sólo SELECT.
-- Toda escritura es por RPC SECURITY DEFINER.
revoke all on table public.estatuto_versiones    from anon, authenticated;
revoke all on table public.estatuto_aperturas    from anon, authenticated;
revoke all on table public.estatuto_aceptaciones from anon, authenticated;
grant select on table public.estatuto_versiones    to authenticated;
grant select on table public.estatuto_aperturas    to authenticated;
grant select on table public.estatuto_aceptaciones to authenticated;

-- Versiones: la publicada la ve cualquier usuario autenticado (es lo que tiene
-- que leer); los borradores sólo Administración y Gerencia.
drop policy if exists "Estatuto: versiones publicadas" on public.estatuto_versiones;
create policy "Estatuto: versiones publicadas"
  on public.estatuto_versiones for select to authenticated
  using (estado = 'publicado');

drop policy if exists "Estatuto: borradores para Administracion y Gerencia" on public.estatuto_versiones;
create policy "Estatuto: borradores para Administracion y Gerencia"
  on public.estatuto_versiones for select to authenticated
  using (public.puede_gestionar_personal_actual() or public.puede_acceder_gerencia_actual());

-- Aperturas y aceptaciones: lo propio, o Administración/Gerencia.
drop policy if exists "Estatuto: aperturas propias" on public.estatuto_aperturas;
create policy "Estatuto: aperturas propias"
  on public.estatuto_aperturas for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

drop policy if exists "Estatuto: aperturas para Administracion y Gerencia" on public.estatuto_aperturas;
create policy "Estatuto: aperturas para Administracion y Gerencia"
  on public.estatuto_aperturas for select to authenticated
  using (public.puede_gestionar_personal_actual() or public.puede_acceder_gerencia_actual());

drop policy if exists "Estatuto: constancias propias" on public.estatuto_aceptaciones;
create policy "Estatuto: constancias propias"
  on public.estatuto_aceptaciones for select to authenticated
  using (empleado_id = public.rondas_usuario_actual_id());

drop policy if exists "Estatuto: constancias para Administracion y Gerencia" on public.estatuto_aceptaciones;
create policy "Estatuto: constancias para Administracion y Gerencia"
  on public.estatuto_aceptaciones for select to authenticated
  using (public.puede_gestionar_personal_actual() or public.puede_acceder_gerencia_actual());

-- ============================================================================
-- 6. VERSIÓN VIGENTE
-- ============================================================================
--
-- La publicada más reciente. Una sola regla, en un solo lugar: el cartel, la
-- aceptación y el control la toman de acá.

create or replace function public.estatuto_version_vigente_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select v.id
  from public.estatuto_versiones v
  where v.estado = 'publicado'
  order by v.publicado_at desc, v.fecha_documento desc
  limit 1
$fn$;

revoke all on function public.estatuto_version_vigente_id() from public, anon;
grant execute on function public.estatuto_version_vigente_id() to authenticated;

-- El texto de la declaración. La UI arma el mismo texto (lib/estatuto.ts) para
-- mostrarlo, pero el que queda en la constancia es éste, armado en el servidor:
-- el cliente no elige qué declaró.
create or replace function public.estatuto_texto_declaracion(p_fecha date)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  select 'Declaro haber leído y tomado conocimiento del Estatuto Interno de '
      || 'Mercosur Seguridad SRL, versión ' || to_char(p_fecha, 'DD/MM/YYYY') || '.'
$fn$;

revoke all on function public.estatuto_texto_declaracion(date) from public, anon;
grant execute on function public.estatuto_texto_declaracion(date) to authenticated;

-- ============================================================================
-- 7. RPC: registrar la apertura
-- ============================================================================
--
-- Silenciosa como `registrar_lectura_evaluacion`: la llama la pantalla al
-- mostrar el texto, y la persona tiene que poder leer aunque esto falle. Sólo
-- registra para quien llama (auth.uid()), nunca para un id recibido.

create or replace function public.estatuto_registrar_apertura(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid      uuid;
  v_empleado uuid;
  v_estado   text;
  v_abierto  timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autenticado');
  end if;

  v_empleado := (
    select u.id from public.usuarios u
    where u.auth_user_id = v_uid and u.estado = 'activo'
    limit 1
  );
  if v_empleado is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inactivo');
  end if;

  v_estado := (select v.estado from public.estatuto_versiones v where v.id = p_version_id);
  if v_estado is null then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  -- Un borrador lo pueden previsualizar Administración/Gerencia, pero esa
  -- lectura no cuenta: no se le puede pedir a nadie que acepte un borrador.
  if v_estado <> 'publicado' then
    return jsonb_build_object('ok', false, 'motivo', 'no_publicada');
  end if;

  insert into public.estatuto_aperturas (version_id, empleado_id, auth_user_id)
  values (p_version_id, v_empleado, v_uid)
  on conflict on constraint estatuto_apertura_unica do nothing;

  v_abierto := (
    select p.abierto_at from public.estatuto_aperturas p
    where p.version_id = p_version_id and p.empleado_id = v_empleado
  );

  return jsonb_build_object('ok', true, 'abierto_at', v_abierto);
end;
$fn$;

revoke all on function public.estatuto_registrar_apertura(uuid) from public, anon;
grant execute on function public.estatuto_registrar_apertura(uuid) to authenticated;

comment on function public.estatuto_registrar_apertura(uuid) is
  'Registra (idempotente) la primera apertura del texto de una version publicada '
  'por el propio usuario autenticado. Acredita acceso, no aceptacion.';

-- ============================================================================
-- 8. RPC: aceptar
-- ============================================================================
--
-- La constancia. El empleado sale de auth.uid(), nunca de un parámetro. Sólo
-- la versión VIGENTE: aceptar hoy una versión reemplazada no tiene sentido y
-- confundiría el control. Requiere haber abierto el texto de esa versión.
-- Idempotente: si ya aceptó, devuelve la constancia existente sin tocarla.

create or replace function public.estatuto_aceptar(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_uid        uuid;
  v_empleado   uuid;
  v_vigente    uuid;
  v_ver        public.estatuto_versiones%rowtype;
  v_abierto    timestamptz;
  v_existente  public.estatuto_aceptaciones%rowtype;
  v_nueva      public.estatuto_aceptaciones%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  v_empleado := (
    select u.id from public.usuarios u
    where u.auth_user_id = v_uid and u.estado = 'activo'
    limit 1
  );
  if v_empleado is null then
    raise exception 'Usuario no encontrado o inactivo' using errcode = '42501';
  end if;

  v_vigente := public.estatuto_version_vigente_id();
  if v_vigente is null or v_vigente <> p_version_id then
    raise exception 'Esa version del Estatuto no es la vigente' using errcode = '22023';
  end if;

  v_ver := (select v from public.estatuto_versiones v where v.id = p_version_id);

  -- Ya aceptada: se devuelve tal cual. No se reescribe la fecha ni nada.
  v_existente := (
    select a from public.estatuto_aceptaciones a
    where a.version_id = p_version_id and a.empleado_id = v_empleado
  );
  if v_existente.id is not null then
    return jsonb_build_object(
      'ok', true, 'ya_aceptada', true,
      'id', v_existente.id, 'aceptado_at', v_existente.aceptado_at,
      'declaracion', v_existente.declaracion
    );
  end if;

  v_abierto := (
    select p.abierto_at from public.estatuto_aperturas p
    where p.version_id = p_version_id and p.empleado_id = v_empleado
  );
  if v_abierto is null then
    raise exception 'Primero hay que abrir el documento completo' using errcode = '22023';
  end if;

  insert into public.estatuto_aceptaciones (
    version_id, empleado_id, auth_user_id,
    version_identificador, fecha_documento, archivo_sha256, texto_sha256,
    declaracion, abierto_at
  ) values (
    v_ver.id, v_empleado, v_uid,
    v_ver.identificador, v_ver.fecha_documento, v_ver.archivo_sha256, v_ver.texto_sha256,
    public.estatuto_texto_declaracion(v_ver.fecha_documento), v_abierto
  )
  on conflict on constraint estatuto_aceptacion_unica do nothing;

  -- Releer: si dos toques llegaron juntos, el segundo no insertó y devuelve la
  -- constancia que dejó el primero.
  v_nueva := (
    select a from public.estatuto_aceptaciones a
    where a.version_id = p_version_id and a.empleado_id = v_empleado
  );

  return jsonb_build_object(
    'ok', true, 'ya_aceptada', false,
    'id', v_nueva.id, 'aceptado_at', v_nueva.aceptado_at,
    'declaracion', v_nueva.declaracion
  );
end;
$fn$;

revoke all on function public.estatuto_aceptar(uuid) from public, anon;
grant execute on function public.estatuto_aceptar(uuid) to authenticated;

comment on function public.estatuto_aceptar(uuid) is
  'Constancia de aceptacion del Estatuto vigente por el propio usuario autenticado. '
  'Exige apertura previa. Idempotente. Inmutable.';

-- ============================================================================
-- 9. RPC: publicar (sólo Gerencia)
-- ============================================================================

create or replace function public.estatuto_publicar_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_quien  uuid;
  v_estado text;
begin
  if auth.uid() is null or not public.puede_acceder_gerencia_actual() then
    raise exception 'Solo Gerencia puede publicar el Estatuto Interno' using errcode = '42501';
  end if;
  v_quien := public.rondas_usuario_actual_id();

  v_estado := (select v.estado from public.estatuto_versiones v where v.id = p_version_id);
  if v_estado is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if v_estado = 'publicado' then
    return jsonb_build_object('ok', true, 'ya_publicada', true);
  end if;

  update public.estatuto_versiones
     set estado = 'publicado', publicado_at = now(), publicado_por = v_quien
   where id = p_version_id;

  return jsonb_build_object('ok', true, 'ya_publicada', false);
end;
$fn$;

revoke all on function public.estatuto_publicar_version(uuid) from public, anon;
grant execute on function public.estatuto_publicar_version(uuid) to authenticated;

comment on function public.estatuto_publicar_version(uuid) is
  'Publica una version del Estatuto (pasa a ser la vigente y pide nueva aceptacion). Solo Gerencia.';

-- ============================================================================
-- 10. RPC: control nominal (Administración y Gerencia)
-- ============================================================================
--
-- Universo: usuarios activos, sin cuentas de prueba. Devuelve UN jsonb y no un
-- set de filas: PostgREST corta en 1000 filas sin avisar, y un listado nominal
-- recortado en silencio diría "pendiente" de gente que no figura.
--
-- Por cada persona: la aceptación de la versión pedida (si existe) y la última
-- versión que aceptó (puede ser una anterior).

create or replace function public.estatuto_control(p_version_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_version uuid;
  v_res     jsonb;
begin
  if auth.uid() is null
     or not (public.puede_gestionar_personal_actual() or public.puede_acceder_gerencia_actual()) then
    raise exception 'Solo Administracion o Gerencia' using errcode = '42501';
  end if;

  v_version := coalesce(p_version_id, public.estatuto_version_vigente_id());

  v_res := (
    select jsonb_build_object(
      'version_id', v_version,
      'personas', coalesce(jsonb_agg(jsonb_build_object(
          'empleado_id', u.id,
          'nombre', u.nombre,
          'apellido', u.apellido,
          'legajo', u.legajo,
          'cuil', u.cuil,
          'rol', u.rol,
          'puesto', u.puesto_organizacional,
          'abierto_at', ap.abierto_at,
          'aceptado_at', ac.aceptado_at,
          'ultima_version_aceptada', ul.version_identificador,
          'ultima_aceptacion_at', ul.aceptado_at
        ) order by u.apellido, u.nombre), '[]'::jsonb)
    )
    from public.usuarios u
    left join public.estatuto_aperturas ap
      on ap.version_id = v_version and ap.empleado_id = u.id
    left join public.estatuto_aceptaciones ac
      on ac.version_id = v_version and ac.empleado_id = u.id
    left join lateral (
      select a.version_identificador, a.aceptado_at
      from public.estatuto_aceptaciones a
      where a.empleado_id = u.id
      order by a.aceptado_at desc
      limit 1
    ) ul on true
    where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
  );

  return v_res;
end;
$fn$;

revoke all on function public.estatuto_control(uuid) from public, anon;
grant execute on function public.estatuto_control(uuid) to authenticated;

comment on function public.estatuto_control(uuid) is
  'Control de aceptaciones del Estatuto: activos (sin prueba) con apertura y aceptacion '
  'de la version pedida (o la vigente). Solo Administracion y Gerencia.';

-- ============================================================================
-- 11. VERSIÓN 21/04/2026 — BORRADOR
-- ============================================================================
--
-- Archivo: public/documentos/estatuto/2026-04-21/estatuto-interno-2026-04-21.doc
-- (copia byte a byte de "ESTATUTO INTERNO MODIFICADO el  21-04-26.doc").
-- texto_sha256: hash del texto que muestra la app (lib/estatuto/contenido-2026-04-21.json).
-- NO se publica acá: publicar es decisión de Gerencia, por la RPC.

insert into public.estatuto_versiones (
  identificador, fecha_documento, archivo_ruta, archivo_nombre,
  archivo_sha256, archivo_bytes, texto_sha256, estado, notas
) values (
  '2026-04-21', date '2026-04-21',
  '/documentos/estatuto/2026-04-21/estatuto-interno-2026-04-21.doc',
  'ESTATUTO INTERNO MODIFICADO el  21-04-26.doc',
  '5feb70d22a7b5fffe100eb56304654678c73328117ecc4de25b8c5db4c46228c',
  90624,
  'b84a4047754434d1f8c111d820a23d2d36d972b060874b8795268961a567c832',
  'borrador',
  'Cargada como borrador. Pendiente revision de Gerencia/asesoria laboral antes de publicar '
  '(ver docs/contexto/ESTATUTO-INTERNO-2026-10-08.md).'
)
on conflict (identificador) do nothing;

notify pgrst, 'reload schema';

commit;
