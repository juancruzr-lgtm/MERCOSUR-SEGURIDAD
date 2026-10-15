-- Protocolos por objetivo — Etapa 2 (PR C): instrucciones y checklist propuesto.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- El checklist de supervisión es genérico: en 90 días registró 9 «observado»
-- contra 5.510 «correcto». El protocolo de cada objetivo dice qué hay que
-- controlar ahí. Esta migración permite que las instrucciones del protocolo
-- se conviertan en puntos del checklist de supervisión DEL objetivo, con el
-- motor que ya existe (checklist_plantillas + checklist_items +
-- objetivos.checklist_plantilla_id + SupervisorMobile), siempre en modo
-- propuesta: la IA propone, una persona valida y aprueba, Gerencia activa.
-- Diseño: docs/contexto/CENTRO-OPERATIVO-OBJETIVO-2026-10-14.md, punto 5.b.
--
-- ── Flujo ────────────────────────────────────────────────────────────────────
--  1. Instrucciones: el texto de una versión se divide en párrafos (una línea
--     no vacía = una instrucción) guardando SÓLO el rango de caracteres y el
--     hash del fragmento. El texto del protocolo no se copia ni se toca.
--  2. La IA (ruta /api/protocolos/controles/proponer) clasifica cada
--     instrucción (informativa / obligación / frecuencia / excepción, quién y
--     cuándo) y propone un control. Antes de proponer, la base compara con los
--     ítems de la plantilla del objetivo y con sus rondas y puntos: lo que ya
--     existe queda marcado como cubierto y no se puede aprobar.
--  3. Una persona (quien prepara protocolos: Administración, Gerencia, jefatura
--     de supervisores, dirección operativa) valida la clasificación y aprueba
--     o rechaza cada propuesta.
--  4. Gerencia activa lo aprobado, y sólo de una versión VIGENTE: se crea (o se
--     reutiliza) una plantilla propia del objetivo, copia de la que tenía más
--     los ítems aprobados, y cada ítem nuevo lleva origen_instruccion_id.
--
-- ── Qué NO hace ──────────────────────────────────────────────────────────────
-- No toca rondas, puntos, alertas, calificaciones, liquidación ni el texto de
-- los protocolos. Un control de ronda, tarea, orden o alerta se puede aprobar
-- como decisión, pero NO se activa: queda como propuesta. Nada se activa sin
-- aprobación previa y nada se activa desde un borrador. Lee rondas_base y
-- ronda_puntos sólo para no duplicar.
--
-- ── Reglas SQL del proyecto ──────────────────────────────────────────────────
-- Nada de `select col into variable`: se asigna con `v := (select ...)`.
-- Rollback en supabase/rollback/20261023120000_protocolo_controles_propuestos_rollback.sql.

begin;

-- ============================================================================
-- 1. CORRIDAS DE IA (registro de tokens)
-- ============================================================================

create table if not exists public.protocolo_ia_corridas (
  id                     uuid primary key default gen_random_uuid(),
  version_id             uuid not null references public.protocolo_versiones(id) on delete restrict,
  objetivo_id            uuid not null references public.objetivos(id) on delete restrict,
  modelo                 text not null check (length(btrim(modelo)) > 0),
  tokens_entrada         integer check (tokens_entrada is null or tokens_entrada >= 0),
  tokens_salida          integer check (tokens_salida is null or tokens_salida >= 0),
  instrucciones_enviadas integer not null default 0 check (instrucciones_enviadas >= 0),
  estado                 text not null check (estado in ('completada', 'error')),
  error                  text,
  creado_por             uuid references public.usuarios(id) on delete restrict,
  creado_at              timestamptz not null default now(),
  constraint protocolo_ia_corrida_error_con_texto check (
    estado <> 'error' or length(btrim(coalesce(error, ''))) > 0
  )
);

create index if not exists idx_protocolo_ia_corridas_objetivo
  on public.protocolo_ia_corridas (objetivo_id, creado_at desc);

comment on table public.protocolo_ia_corridas is
  'Cada pedido a la IA para clasificar instrucciones y proponer controles, con '
  'modelo y tokens. Inmutable.';

-- ============================================================================
-- 2. INSTRUCCIONES
-- ============================================================================
-- inicio/fin: posiciones en caracteres (no bytes) dentro de
-- protocolo_versiones.texto, 0-based y fin exclusivo:
--   fragmento = substr(texto, inicio + 1, fin - inicio)
-- texto_sha256 es el hash de ese fragmento. Si el texto de un borrador manual
-- se edita después, el hash deja de coincidir y la instrucción se marca
-- obsoleta al volver a dividir: nunca se «corre» un rango en silencio.

create table if not exists public.protocolo_instrucciones (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references public.protocolo_versiones(id) on delete restrict,
  -- Copia de la versión, para RLS y para consultas por objetivo.
  objetivo_id         uuid not null references public.objetivos(id) on delete restrict,
  orden               integer not null check (orden >= 1),
  inicio              integer not null check (inicio >= 0),
  fin                 integer not null,
  texto_sha256        text not null check (texto_sha256 ~ '^[0-9a-f]{64}$'),
  -- Lo que propuso la IA (se pisa en cada corrida mientras no esté validada).
  clasificacion_ia    text check (clasificacion_ia in ('informativa', 'obligacion', 'frecuencia', 'excepcion')),
  quien_ia            text,
  cuando_ia           text,
  ia_corrida_id       uuid references public.protocolo_ia_corridas(id) on delete restrict,
  -- Lo que validó una persona. Es lo único que vale para aprobar controles.
  clasificacion       text check (clasificacion in ('informativa', 'obligacion', 'frecuencia', 'excepcion')),
  quien               text check (quien is null or length(quien) <= 200),
  cuando              text check (cuando is null or length(cuando) <= 200),
  validada_por        uuid references public.usuarios(id) on delete restrict,
  validada_at         timestamptz,
  obsoleta_at         timestamptz,
  creado_por          uuid references public.usuarios(id) on delete restrict,
  creado_at           timestamptz not null default now(),
  constraint protocolo_instruccion_rango check (fin > inicio),
  constraint protocolo_instruccion_validada_completa check (
    (validada_at is null and validada_por is null)
    or (validada_at is not null and validada_por is not null and clasificacion is not null)
  )
);

create unique index if not exists protocolo_instrucciones_orden_unico
  on public.protocolo_instrucciones (version_id, orden) where obsoleta_at is null;

create index if not exists idx_protocolo_instrucciones_objetivo
  on public.protocolo_instrucciones (objetivo_id, version_id);

comment on table public.protocolo_instrucciones is
  'Parrafos de una version de protocolo: rango de caracteres y hash, sin copiar '
  'ni tocar el texto. Clasificacion propuesta por IA y validada por una persona.';

-- ============================================================================
-- 3. CONTROLES PROPUESTOS
-- ============================================================================

create table if not exists public.protocolo_controles_propuestos (
  id                 uuid primary key default gen_random_uuid(),
  instruccion_id     uuid not null references public.protocolo_instrucciones(id) on delete restrict,
  version_id         uuid not null references public.protocolo_versiones(id) on delete restrict,
  objetivo_id        uuid not null references public.objetivos(id) on delete restrict,
  origen             text not null check (origen in ('ia', 'manual')),
  ia_corrida_id      uuid references public.protocolo_ia_corridas(id) on delete restrict,
  -- Destino del control. Sólo checklist_supervision se activa en esta etapa;
  -- el resto queda como propuesta documentada.
  destino            text not null check (destino in (
                       'checklist_supervision', 'punto_ronda', 'tarea_turno',
                       'orden_puntual', 'alerta')),
  -- Texto tal cual lo propuso la IA (o la persona, si es manual). Inmutable.
  texto_original     text not null check (length(btrim(texto_original)) > 0),
  -- Texto que se va a usar; se puede corregir mientras está propuesto.
  texto_item         text not null check (length(btrim(texto_item)) between 1 and 500),
  criticidad         text not null default 'normal' check (criticidad in ('normal', 'alta')),
  foto_obligatoria   boolean not null default false,
  quien              text check (quien is null or length(quien) <= 200),
  cuando             text check (cuando is null or length(cuando) <= 200),
  motivo             text,
  -- Deduplicación: lo que ya controla esto en el objetivo.
  existente_tipo     text check (existente_tipo in ('checklist_item', 'ronda', 'ronda_punto', 'control_propuesto')),
  existente_id       uuid,
  existente_texto    text,
  estado             text not null default 'propuesto'
                       check (estado in ('propuesto', 'aprobado', 'rechazado', 'activado')),
  aprobado_por       uuid references public.usuarios(id) on delete restrict,
  aprobado_at        timestamptz,
  rechazado_por      uuid references public.usuarios(id) on delete restrict,
  rechazado_at       timestamptz,
  motivo_rechazo     text,
  activado_por       uuid references public.usuarios(id) on delete restrict,
  activado_at        timestamptz,
  plantilla_id       uuid references public.checklist_plantillas(id) on delete restrict,
  checklist_item_id  uuid references public.checklist_items(id) on delete restrict,
  creado_por         uuid references public.usuarios(id) on delete restrict,
  creado_at          timestamptz not null default now(),
  actualizado_at     timestamptz not null default now(),
  constraint protocolo_control_existente_completo check ((existente_tipo is null) = (existente_id is null)),
  constraint protocolo_control_aprobado_completo check (
    estado not in ('aprobado', 'activado') or (aprobado_por is not null and aprobado_at is not null)
  ),
  constraint protocolo_control_rechazo_completo check (
    estado <> 'rechazado' or (rechazado_por is not null and rechazado_at is not null
                              and length(btrim(coalesce(motivo_rechazo, ''))) > 0)
  ),
  constraint protocolo_control_activado_completo check (
    estado <> 'activado' or (activado_por is not null and activado_at is not null
                             and destino = 'checklist_supervision'
                             and plantilla_id is not null and checklist_item_id is not null)
  )
);

-- Un solo control en curso por instrucción (los rechazados quedan de historial).
create unique index if not exists protocolo_controles_uno_por_instruccion
  on public.protocolo_controles_propuestos (instruccion_id) where estado <> 'rechazado';

create index if not exists idx_protocolo_controles_objetivo
  on public.protocolo_controles_propuestos (objetivo_id, estado);

comment on table public.protocolo_controles_propuestos is
  'Control propuesto para una instruccion del protocolo. propuesto -> aprobado | '
  'rechazado; aprobado -> activado (solo checklist de supervision, solo Gerencia, '
  'solo desde una version vigente) | rechazado.';

-- ============================================================================
-- 4. TRAZABILIDAD EN EL MOTOR DE CHECKLIST
-- ============================================================================

alter table public.checklist_items
  add column if not exists origen_instruccion_id uuid
    references public.protocolo_instrucciones(id) on delete restrict;

-- Plantilla propia del objetivo (NULL = plantilla general, como hasta hoy).
alter table public.checklist_plantillas
  add column if not exists objetivo_id uuid references public.objetivos(id) on delete restrict;
alter table public.checklist_plantillas
  add column if not exists copiada_de_plantilla_id uuid references public.checklist_plantillas(id) on delete restrict;

create index if not exists idx_checklist_items_origen_instruccion
  on public.checklist_items (origen_instruccion_id) where origen_instruccion_id is not null;
create index if not exists idx_checklist_plantillas_objetivo
  on public.checklist_plantillas (objetivo_id) where objetivo_id is not null;

comment on column public.checklist_items.origen_instruccion_id is
  'Instruccion del protocolo de la que sale este item (NULL = item cargado a mano).';
comment on column public.checklist_plantillas.objetivo_id is
  'Si tiene valor, la plantilla es propia de ese objetivo (creada desde su protocolo).';

-- ============================================================================
-- 5. INTEGRIDAD
-- ============================================================================

-- Texto comparable: minúsculas, sin acentos ni signos, espacios simples.
create or replace function public.protocolo_normalizar(p text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
    '[^a-z0-9]+', ' ', 'g'))
$fn$;

revoke all on function public.protocolo_normalizar(text) from public, anon;
grant execute on function public.protocolo_normalizar(text) to authenticated;

-- El fragmento actual de una instrucción en el texto de su versión.
create or replace function public.protocolo_fragmento(p_texto text, p_inicio integer, p_fin integer)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $fn$
  select substr(p_texto, p_inicio + 1, p_fin - p_inicio)
$fn$;

revoke all on function public.protocolo_fragmento(text, integer, integer) from public, anon;
grant execute on function public.protocolo_fragmento(text, integer, integer) to authenticated;

create or replace function public.protocolo_instruccion_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
declare
  v_ver public.protocolo_versiones%rowtype;
  v_frag text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Las instrucciones de protocolo no se borran' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    v_ver := (select v from public.protocolo_versiones v where v.id = new.version_id);
    if v_ver.id is null then
      raise exception 'Version inexistente' using errcode = '22023';
    end if;
    if new.fin > char_length(v_ver.texto) then
      raise exception 'El rango de la instruccion excede el texto' using errcode = '22023';
    end if;
    v_frag := public.protocolo_fragmento(v_ver.texto, new.inicio, new.fin);
    if btrim(v_frag) = '' then
      raise exception 'Una instruccion no puede ser texto vacio' using errcode = '22023';
    end if;
    new.objetivo_id := v_ver.objetivo_id;
    new.texto_sha256 := encode(sha256(convert_to(v_frag, 'UTF8')), 'hex');
    new.obsoleta_at := null;
    return new;
  end if;

  -- UPDATE: el rango, el hash y la versión no cambian nunca.
  if new.version_id   is distinct from old.version_id
     or new.objetivo_id  is distinct from old.objetivo_id
     or new.orden        is distinct from old.orden
     or new.inicio       is distinct from old.inicio
     or new.fin          is distinct from old.fin
     or new.texto_sha256 is distinct from old.texto_sha256
     or new.creado_at    is distinct from old.creado_at then
    raise exception 'El rango de una instruccion no se modifica' using errcode = '42501';
  end if;
  if old.obsoleta_at is not null and new is distinct from old then
    raise exception 'Una instruccion obsoleta no se modifica' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_protocolo_instruccion_proteger on public.protocolo_instrucciones;
create trigger trg_protocolo_instruccion_proteger
  before insert or update or delete on public.protocolo_instrucciones
  for each row execute function public.protocolo_instruccion_proteger();
drop trigger if exists trg_protocolo_instrucciones_sin_truncate on public.protocolo_instrucciones;
create trigger trg_protocolo_instrucciones_sin_truncate
  before truncate on public.protocolo_instrucciones
  for each statement execute function public.protocolo_registro_inmutable();

create or replace function public.protocolo_control_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los controles propuestos no se borran: rechazar con motivo' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'propuesto' then
      raise exception 'Un control nace como propuesto' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.protocolo_instrucciones i
      where i.id = new.instruccion_id and i.version_id = new.version_id
        and i.objetivo_id = new.objetivo_id and i.obsoleta_at is null
    ) then
      raise exception 'La instruccion no corresponde a la version u objetivo, o esta obsoleta' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.instruccion_id is distinct from old.instruccion_id
     or new.version_id is distinct from old.version_id
     or new.objetivo_id is distinct from old.objetivo_id
     or new.origen is distinct from old.origen
     or new.ia_corrida_id is distinct from old.ia_corrida_id
     or new.texto_original is distinct from old.texto_original
     or new.creado_at is distinct from old.creado_at then
    raise exception 'El origen de un control propuesto no se modifica' using errcode = '42501';
  end if;

  if old.estado in ('rechazado', 'activado') and new is distinct from old then
    raise exception 'Un control % no se modifica', old.estado using errcode = '42501';
  end if;

  if old.estado <> 'propuesto' and (
       new.destino is distinct from old.destino
    or new.texto_item is distinct from old.texto_item
    or new.criticidad is distinct from old.criticidad
    or new.foto_obligatoria is distinct from old.foto_obligatoria
  ) then
    raise exception 'Solo se corrige un control mientras esta propuesto' using errcode = '42501';
  end if;

  if new.estado is distinct from old.estado and not (
       (old.estado = 'propuesto' and new.estado in ('aprobado', 'rechazado'))
    or (old.estado = 'aprobado'  and new.estado in ('activado', 'rechazado'))
  ) then
    raise exception 'Transicion de estado no permitida: % -> %', old.estado, new.estado
      using errcode = '42501';
  end if;

  new.actualizado_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_protocolo_control_proteger on public.protocolo_controles_propuestos;
create trigger trg_protocolo_control_proteger
  before insert or update or delete on public.protocolo_controles_propuestos
  for each row execute function public.protocolo_control_proteger();
drop trigger if exists trg_protocolo_controles_sin_truncate on public.protocolo_controles_propuestos;
create trigger trg_protocolo_controles_sin_truncate
  before truncate on public.protocolo_controles_propuestos
  for each statement execute function public.protocolo_registro_inmutable();

drop trigger if exists trg_protocolo_ia_corridas_inmutable on public.protocolo_ia_corridas;
create trigger trg_protocolo_ia_corridas_inmutable
  before update or delete on public.protocolo_ia_corridas
  for each row execute function public.protocolo_registro_inmutable();
drop trigger if exists trg_protocolo_ia_corridas_sin_truncate on public.protocolo_ia_corridas;
create trigger trg_protocolo_ia_corridas_sin_truncate
  before truncate on public.protocolo_ia_corridas
  for each statement execute function public.protocolo_registro_inmutable();

-- ============================================================================
-- 6. PERMISOS Y RLS
-- ============================================================================
-- Ver: quien ve el protocolo del objetivo (protocolo_puede_ver). Proponer,
-- validar, aprobar y rechazar: quien prepara protocolos. Activar: Gerencia.
-- Se revoca lo que conceden los DEFAULT PRIVILEGES y se da sólo SELECT.

alter table public.protocolo_ia_corridas          enable row level security;
alter table public.protocolo_instrucciones        enable row level security;
alter table public.protocolo_controles_propuestos enable row level security;

revoke all on table public.protocolo_ia_corridas          from anon, authenticated;
revoke all on table public.protocolo_instrucciones        from anon, authenticated;
revoke all on table public.protocolo_controles_propuestos from anon, authenticated;
grant select on table public.protocolo_ia_corridas          to authenticated;
grant select on table public.protocolo_instrucciones        to authenticated;
grant select on table public.protocolo_controles_propuestos to authenticated;

drop policy if exists "Protocolos: corridas IA para quien gestiona el objetivo" on public.protocolo_ia_corridas;
create policy "Protocolos: corridas IA para quien gestiona el objetivo"
  on public.protocolo_ia_corridas for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

drop policy if exists "Protocolos: instrucciones para quien gestiona el objetivo" on public.protocolo_instrucciones;
create policy "Protocolos: instrucciones para quien gestiona el objetivo"
  on public.protocolo_instrucciones for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

drop policy if exists "Protocolos: controles para quien gestiona el objetivo" on public.protocolo_controles_propuestos;
create policy "Protocolos: controles para quien gestiona el objetivo"
  on public.protocolo_controles_propuestos for select to authenticated
  using (public.protocolo_puede_ver(objetivo_id));

-- Exige preparar + ver el objetivo de la versión. Devuelve la versión.
create or replace function public.protocolo_version_para_preparar(p_version_id uuid)
returns public.protocolo_versiones
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver public.protocolo_versiones%rowtype;
begin
  if auth.uid() is null or not public.protocolo_puede_preparar() then
    raise exception 'No tenes permiso para preparar protocolos' using errcode = '42501';
  end if;
  v_ver := (select v from public.protocolo_versiones v where v.id = p_version_id);
  if v_ver.id is null then
    raise exception 'Version inexistente' using errcode = '22023';
  end if;
  if not public.protocolo_puede_ver(v_ver.objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  if v_ver.estado in ('reemplazado', 'descartado') then
    raise exception 'La version esta % : no se proponen controles sobre ella', v_ver.estado using errcode = '22023';
  end if;
  return v_ver;
end;
$fn$;

revoke all on function public.protocolo_version_para_preparar(uuid) from public, anon, authenticated;

-- ============================================================================
-- 7. DEDUPLICACIÓN
-- ============================================================================
-- ¿Ya hay algo en el objetivo que controle esto? Primero se valida la
-- referencia que trajo la IA (que sea realmente de ESTE objetivo); si no hay,
-- se compara el texto normalizado contra: ítems activos de la plantilla del
-- objetivo, puntos y rondas activas del objetivo, y otros controles en curso.
-- Devuelve {tipo, id, texto} o NULL.

create or replace function public.protocolo_control_existente(
  p_objetivo_id uuid,
  p_texto text,
  p_excluir_control uuid default null,
  p_tipo_ia text default null,
  p_id_ia uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_norm      text;
  v_plantilla uuid;
  v_res       jsonb;
begin
  v_norm := public.protocolo_normalizar(p_texto);
  v_plantilla := (select o.checklist_plantilla_id from public.objetivos o where o.id = p_objetivo_id);

  -- 1) Referencia de la IA, sólo si pertenece al objetivo.
  if p_id_ia is not null then
    if p_tipo_ia = 'checklist_item' then
      v_res := (select jsonb_build_object('tipo', 'checklist_item', 'id', ci.id, 'texto', ci.texto)
                from public.checklist_items ci
                where ci.id = p_id_ia and ci.plantilla_id = v_plantilla and ci.activo);
    elsif p_tipo_ia = 'ronda' then
      v_res := (select jsonb_build_object('tipo', 'ronda', 'id', r.id, 'texto', r.nombre)
                from public.rondas_base r
                where r.id = p_id_ia and r.objetivo_id = p_objetivo_id and r.activo);
    elsif p_tipo_ia = 'ronda_punto' then
      v_res := (select jsonb_build_object('tipo', 'ronda_punto', 'id', rp.id, 'texto', r.nombre || ' · ' || rp.nombre)
                from public.ronda_puntos rp join public.rondas_base r on r.id = rp.ronda_base_id
                where rp.id = p_id_ia and r.objetivo_id = p_objetivo_id and r.activo and rp.activo);
    end if;
    if v_res is not null then return v_res; end if;
  end if;

  if v_norm = '' then return null; end if;

  -- 2) Mismo texto en la plantilla del objetivo.
  v_res := (select jsonb_build_object('tipo', 'checklist_item', 'id', ci.id, 'texto', ci.texto)
            from public.checklist_items ci
            where ci.plantilla_id = v_plantilla and ci.activo
              and public.protocolo_normalizar(ci.texto) = v_norm
            order by ci.orden limit 1);
  if v_res is not null then return v_res; end if;

  -- 3) Mismo texto en un punto o una ronda activa del objetivo.
  v_res := (select jsonb_build_object('tipo', 'ronda_punto', 'id', rp.id, 'texto', r.nombre || ' · ' || rp.nombre)
            from public.ronda_puntos rp join public.rondas_base r on r.id = rp.ronda_base_id
            where r.objetivo_id = p_objetivo_id and r.activo and rp.activo
              and v_norm in (public.protocolo_normalizar(rp.nombre), public.protocolo_normalizar(rp.descripcion))
            limit 1);
  if v_res is not null then return v_res; end if;
  v_res := (select jsonb_build_object('tipo', 'ronda', 'id', r.id, 'texto', r.nombre)
            from public.rondas_base r
            where r.objetivo_id = p_objetivo_id and r.activo
              and v_norm in (public.protocolo_normalizar(r.nombre), public.protocolo_normalizar(r.descripcion))
            limit 1);
  if v_res is not null then return v_res; end if;

  -- 4) Otro control en curso del mismo objetivo con el mismo texto.
  v_res := (select jsonb_build_object('tipo', 'control_propuesto', 'id', c.id, 'texto', c.texto_item)
            from public.protocolo_controles_propuestos c
            where c.objetivo_id = p_objetivo_id and c.estado <> 'rechazado'
              and c.id is distinct from p_excluir_control
              and public.protocolo_normalizar(c.texto_item) = v_norm
            order by c.creado_at limit 1);
  return v_res;
end;
$fn$;

revoke all on function public.protocolo_control_existente(uuid, text, uuid, text, uuid) from public, anon, authenticated;

-- ============================================================================
-- 8. RPC: INSTRUCCIONES
-- ============================================================================

-- Divide la versión en instrucciones: una línea no vacía = una instrucción,
-- sin espacios al borde. Idempotente: si ya están y el hash coincide, no hace
-- nada. Si el texto cambió (borrador manual editado), marca obsoletas las que
-- ya no coinciden y vuelve a dividir.
create or replace function public.protocolo_instrucciones_segmentar(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver       public.protocolo_versiones%rowtype;
  v_usuario   uuid;
  v_linea     text;
  v_pos       integer := 0;
  v_lead      integer;
  v_core      text;
  v_orden     integer := 0;
  v_obsoletas integer := 0;
  v_creadas   integer := 0;
begin
  v_ver := public.protocolo_version_para_preparar(p_version_id);
  v_usuario := public.rondas_usuario_actual_id();

  -- ¿Siguen valiendo las que hay?
  if exists (select 1 from public.protocolo_instrucciones i where i.version_id = v_ver.id and i.obsoleta_at is null) then
    if not exists (
      select 1 from public.protocolo_instrucciones i
      where i.version_id = v_ver.id and i.obsoleta_at is null
        and i.texto_sha256 <> encode(sha256(convert_to(public.protocolo_fragmento(v_ver.texto, i.inicio, i.fin), 'UTF8')), 'hex')
    ) and not exists (
      select 1 from public.protocolo_instrucciones i
      where i.version_id = v_ver.id and i.obsoleta_at is null and i.fin > char_length(v_ver.texto)
    ) then
      return jsonb_build_object('ok', true, 'creadas', 0, 'obsoletas', 0,
        'total', (select count(*) from public.protocolo_instrucciones i where i.version_id = v_ver.id and i.obsoleta_at is null));
    end if;

    -- El texto cambió: todas las anteriores quedan obsoletas (con su historial).
    update public.protocolo_instrucciones i set obsoleta_at = now()
    where i.version_id = v_ver.id and i.obsoleta_at is null;
    get diagnostics v_obsoletas = row_count;
    update public.protocolo_controles_propuestos c
       set estado = 'rechazado', rechazado_por = v_usuario, rechazado_at = now(),
           motivo_rechazo = 'El texto del borrador cambio: la instruccion quedo obsoleta'
    where c.version_id = v_ver.id and c.estado in ('propuesto', 'aprobado');
  end if;

  foreach v_linea in array string_to_array(v_ver.texto, E'\n') loop
    v_core := btrim(v_linea, E' \t\r');
    if char_length(v_core) > 0 then
      v_lead := char_length(v_linea) - char_length(ltrim(v_linea, E' \t\r'));
      v_orden := v_orden + 1;
      insert into public.protocolo_instrucciones (version_id, objetivo_id, orden, inicio, fin, texto_sha256, creado_por)
      values (v_ver.id, v_ver.objetivo_id, v_orden, v_pos + v_lead, v_pos + v_lead + char_length(v_core),
              repeat('0', 64), v_usuario);
      v_creadas := v_creadas + 1;
    end if;
    v_pos := v_pos + char_length(v_linea) + 1;
  end loop;

  return jsonb_build_object('ok', true, 'creadas', v_creadas, 'obsoletas', v_obsoletas, 'total', v_creadas);
end;
$fn$;

revoke all on function public.protocolo_instrucciones_segmentar(uuid) from public, anon;
grant execute on function public.protocolo_instrucciones_segmentar(uuid) to authenticated;

-- Valida (o corrige) la clasificación de una instrucción.
create or replace function public.protocolo_instruccion_validar(
  p_instruccion_id uuid,
  p_clasificacion text,
  p_quien text default null,
  p_cuando text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ins public.protocolo_instrucciones%rowtype;
begin
  v_ins := (select i from public.protocolo_instrucciones i where i.id = p_instruccion_id);
  if v_ins.id is null then
    raise exception 'Instruccion inexistente' using errcode = '22023';
  end if;
  perform public.protocolo_version_para_preparar(v_ins.version_id);
  if v_ins.obsoleta_at is not null then
    raise exception 'La instruccion esta obsoleta' using errcode = '22023';
  end if;
  if p_clasificacion is null or p_clasificacion not in ('informativa', 'obligacion', 'frecuencia', 'excepcion') then
    raise exception 'Clasificacion invalida' using errcode = '22023';
  end if;
  if p_clasificacion = 'informativa' and exists (
    select 1 from public.protocolo_controles_propuestos c
    where c.instruccion_id = v_ins.id and c.estado in ('aprobado', 'activado')
  ) then
    raise exception 'La instruccion ya tiene un control aprobado: no puede ser informativa' using errcode = '22023';
  end if;

  update public.protocolo_instrucciones
     set clasificacion = p_clasificacion,
         quien = nullif(btrim(left(coalesce(p_quien, ''), 200)), ''),
         cuando = nullif(btrim(left(coalesce(p_cuando, ''), 200)), ''),
         validada_por = public.rondas_usuario_actual_id(),
         validada_at = now()
   where id = v_ins.id;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.protocolo_instruccion_validar(uuid, text, text, text) from public, anon;
grant execute on function public.protocolo_instruccion_validar(uuid, text, text, text) to authenticated;

-- ============================================================================
-- 9. RPC: CONTEXTO PARA LA IA Y REGISTRO DE LA CORRIDA
-- ============================================================================

-- Lo que la ruta de IA necesita: instrucciones con su texto y lo que ya existe
-- en el objetivo (ítems de la plantilla, rondas y puntos activos).
create or replace function public.protocolo_controles_contexto(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver       public.protocolo_versiones%rowtype;
  v_plantilla uuid;
begin
  v_ver := public.protocolo_version_para_preparar(p_version_id);
  v_plantilla := (select o.checklist_plantilla_id from public.objetivos o where o.id = v_ver.objetivo_id);

  return jsonb_build_object(
    'version_id', v_ver.id,
    'objetivo_id', v_ver.objetivo_id,
    'objetivo_nombre', (select o.nombre from public.objetivos o where o.id = v_ver.objetivo_id),
    'titulo', v_ver.titulo,
    'instrucciones', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id, 'orden', i.orden,
          'texto', public.protocolo_fragmento(v_ver.texto, i.inicio, i.fin),
          'clasificacion', i.clasificacion,
          'tiene_control', exists (select 1 from public.protocolo_controles_propuestos c
                                   where c.instruccion_id = i.id and c.estado <> 'rechazado')
        ) order by i.orden), '[]'::jsonb)
      from public.protocolo_instrucciones i
      where i.version_id = v_ver.id and i.obsoleta_at is null),
    'checklist', (
      select coalesce(jsonb_agg(jsonb_build_object('id', ci.id, 'texto', ci.texto) order by ci.orden), '[]'::jsonb)
      from public.checklist_items ci
      where ci.plantilla_id = v_plantilla and ci.activo),
    'rondas', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'nombre', r.nombre, 'descripcion', r.descripcion,
          'intervalo_minutos', r.intervalo_minutos,
          'puntos', (select coalesce(jsonb_agg(jsonb_build_object('id', rp.id, 'nombre', rp.nombre, 'descripcion', rp.descripcion)
                                               order by rp.orden), '[]'::jsonb)
                     from public.ronda_puntos rp where rp.ronda_base_id = r.id and rp.activo)
        ) order by r.nombre), '[]'::jsonb)
      from public.rondas_base r
      where r.objetivo_id = v_ver.objetivo_id and r.activo)
  );
end;
$fn$;

revoke all on function public.protocolo_controles_contexto(uuid) from public, anon;
grant execute on function public.protocolo_controles_contexto(uuid) to authenticated;

-- Registra una corrida de IA (con tokens) y sus propuestas. p_propuestas es un
-- arreglo de objetos {instruccion_id, clasificacion, quien, cuando, destino,
-- texto_item, criticidad, foto_obligatoria, motivo, existente_tipo,
-- existente_id}. destino NULL o 'ninguno' = sólo clasificación. No pisa lo que
-- validó una persona ni crea un segundo control para una instrucción que ya
-- tiene uno en curso. Con p_error, registra la corrida fallida y nada más.
create or replace function public.protocolo_registrar_corrida_ia(
  p_version_id uuid,
  p_modelo text,
  p_tokens_entrada integer,
  p_tokens_salida integer,
  p_propuestas jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ver      public.protocolo_versiones%rowtype;
  v_usuario  uuid;
  v_corrida  uuid;
  v_p        jsonb;
  v_ins      public.protocolo_instrucciones%rowtype;
  v_clas     text;
  v_destino  text;
  v_texto    text;
  v_exist    jsonb;
  v_id_ia    uuid;
  v_creadas  integer := 0;
  v_omitidas integer := 0;
  v_enviadas integer;
begin
  v_ver := public.protocolo_version_para_preparar(p_version_id);
  v_usuario := public.rondas_usuario_actual_id();
  v_enviadas := case when jsonb_typeof(p_propuestas) = 'array' then jsonb_array_length(p_propuestas) else 0 end;

  insert into public.protocolo_ia_corridas (
    version_id, objetivo_id, modelo, tokens_entrada, tokens_salida,
    instrucciones_enviadas, estado, error, creado_por
  ) values (
    v_ver.id, v_ver.objetivo_id, coalesce(nullif(btrim(p_modelo), ''), 'desconocido'),
    case when p_tokens_entrada >= 0 then p_tokens_entrada end,
    case when p_tokens_salida >= 0 then p_tokens_salida end, v_enviadas,
    case when p_error is null then 'completada' else 'error' end, left(p_error, 500), v_usuario
  ) returning id into v_corrida;

  if p_error is not null or v_enviadas = 0 then
    return jsonb_build_object('ok', p_error is null, 'corrida_id', v_corrida, 'creadas', 0, 'omitidas', 0);
  end if;

  -- Se registra la corrida aunque después se omitan propuestas inválidas: el
  -- gasto de tokens ya ocurrió.
  for v_p in select value from jsonb_array_elements(p_propuestas) loop
    v_ins := null;
    begin
      v_ins := (select i from public.protocolo_instrucciones i
                where i.id = (v_p->>'instruccion_id')::uuid
                  and i.version_id = v_ver.id and i.obsoleta_at is null);
    exception when invalid_text_representation then
      v_ins := null;
    end;
    if v_ins.id is null then
      v_omitidas := v_omitidas + 1;
      continue;
    end if;

    v_clas := v_p->>'clasificacion';
    if v_clas not in ('informativa', 'obligacion', 'frecuencia', 'excepcion') then v_clas := null; end if;

    -- La propuesta de la IA se pisa en cada corrida; lo validado, nunca.
    update public.protocolo_instrucciones
       set clasificacion_ia = v_clas,
           quien_ia = nullif(btrim(left(coalesce(v_p->>'quien', ''), 200)), ''),
           cuando_ia = nullif(btrim(left(coalesce(v_p->>'cuando', ''), 200)), ''),
           ia_corrida_id = v_corrida
     where id = v_ins.id;

    v_destino := v_p->>'destino';
    v_texto := btrim(left(coalesce(v_p->>'texto_item', ''), 500));
    if v_destino is null or v_destino not in ('checklist_supervision', 'punto_ronda', 'tarea_turno', 'orden_puntual', 'alerta')
       or v_texto = '' or coalesce(v_ins.clasificacion, v_clas) = 'informativa' then
      continue;
    end if;
    if exists (select 1 from public.protocolo_controles_propuestos c
               where c.instruccion_id = v_ins.id and c.estado <> 'rechazado') then
      v_omitidas := v_omitidas + 1;
      continue;
    end if;

    v_id_ia := null;
    begin
      v_id_ia := nullif(v_p->>'existente_id', '')::uuid;
    exception when invalid_text_representation then
      v_id_ia := null;
    end;
    v_exist := public.protocolo_control_existente(v_ver.objetivo_id, v_texto, null, v_p->>'existente_tipo', v_id_ia);

    insert into public.protocolo_controles_propuestos (
      instruccion_id, version_id, objetivo_id, origen, ia_corrida_id, destino,
      texto_original, texto_item, criticidad, foto_obligatoria, quien, cuando, motivo,
      existente_tipo, existente_id, existente_texto, creado_por
    ) values (
      v_ins.id, v_ver.id, v_ver.objetivo_id, 'ia', v_corrida, v_destino,
      v_texto, v_texto,
      case when v_p->>'criticidad' = 'alta' then 'alta' else 'normal' end,
      coalesce((v_p->>'foto_obligatoria')::boolean, false),
      nullif(btrim(left(coalesce(v_p->>'quien', ''), 200)), ''),
      nullif(btrim(left(coalesce(v_p->>'cuando', ''), 200)), ''),
      nullif(btrim(left(coalesce(v_p->>'motivo', ''), 1000)), ''),
      v_exist->>'tipo', (v_exist->>'id')::uuid, v_exist->>'texto', v_usuario
    );
    v_creadas := v_creadas + 1;
  end loop;

  -- La corrida es inmutable: el total de propuestas se informa en la respuesta
  -- y se cuenta por ia_corrida_id.
  return jsonb_build_object('ok', true, 'corrida_id', v_corrida, 'creadas', v_creadas, 'omitidas', v_omitidas);
end;
$fn$;

revoke all on function public.protocolo_registrar_corrida_ia(uuid, text, integer, integer, jsonb, text) from public, anon;
grant execute on function public.protocolo_registrar_corrida_ia(uuid, text, integer, integer, jsonb, text) to authenticated;

-- ============================================================================
-- 10. RPC: PROPUESTA MANUAL, CORRECCIÓN, APROBACIÓN, RECHAZO
-- ============================================================================

create or replace function public.protocolo_control_proponer(
  p_instruccion_id uuid,
  p_destino text,
  p_texto_item text,
  p_criticidad text default 'normal',
  p_foto_obligatoria boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_ins   public.protocolo_instrucciones%rowtype;
  v_texto text;
  v_exist jsonb;
  v_id    uuid;
begin
  v_ins := (select i from public.protocolo_instrucciones i where i.id = p_instruccion_id);
  if v_ins.id is null then
    raise exception 'Instruccion inexistente' using errcode = '22023';
  end if;
  perform public.protocolo_version_para_preparar(v_ins.version_id);
  v_texto := btrim(coalesce(p_texto_item, ''));
  if v_texto = '' or char_length(v_texto) > 500 then
    raise exception 'El texto del control es obligatorio (hasta 500 caracteres)' using errcode = '22023';
  end if;
  if p_destino is null or p_destino not in ('checklist_supervision', 'punto_ronda', 'tarea_turno', 'orden_puntual', 'alerta') then
    raise exception 'Destino invalido' using errcode = '22023';
  end if;
  if exists (select 1 from public.protocolo_controles_propuestos c
             where c.instruccion_id = v_ins.id and c.estado <> 'rechazado') then
    raise exception 'La instruccion ya tiene un control en curso' using errcode = '22023';
  end if;
  v_exist := public.protocolo_control_existente(v_ins.objetivo_id, v_texto);

  insert into public.protocolo_controles_propuestos (
    instruccion_id, version_id, objetivo_id, origen, destino, texto_original, texto_item,
    criticidad, foto_obligatoria, quien, cuando, existente_tipo, existente_id, existente_texto, creado_por
  ) values (
    v_ins.id, v_ins.version_id, v_ins.objetivo_id, 'manual', p_destino, v_texto, v_texto,
    case when p_criticidad = 'alta' then 'alta' else 'normal' end, coalesce(p_foto_obligatoria, false),
    coalesce(v_ins.quien, v_ins.quien_ia), coalesce(v_ins.cuando, v_ins.cuando_ia),
    v_exist->>'tipo', (v_exist->>'id')::uuid, v_exist->>'texto', public.rondas_usuario_actual_id()
  ) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'existente', v_exist);
end;
$fn$;

revoke all on function public.protocolo_control_proponer(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.protocolo_control_proponer(uuid, text, text, text, boolean) to authenticated;

-- Corrige destino/texto/criticidad/foto de un control propuesto. Vuelve a
-- buscar duplicados con el texto nuevo.
create or replace function public.protocolo_control_editar(
  p_control_id uuid,
  p_destino text,
  p_texto_item text,
  p_criticidad text,
  p_foto_obligatoria boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c     public.protocolo_controles_propuestos%rowtype;
  v_texto text;
  v_exist jsonb;
begin
  v_c := (select c from public.protocolo_controles_propuestos c where c.id = p_control_id);
  if v_c.id is null then
    raise exception 'Control inexistente' using errcode = '22023';
  end if;
  perform public.protocolo_version_para_preparar(v_c.version_id);
  if v_c.estado <> 'propuesto' then
    raise exception 'Solo se corrige un control mientras esta propuesto' using errcode = '42501';
  end if;
  v_texto := btrim(coalesce(p_texto_item, ''));
  if v_texto = '' or char_length(v_texto) > 500 then
    raise exception 'El texto del control es obligatorio (hasta 500 caracteres)' using errcode = '22023';
  end if;
  if p_destino is null or p_destino not in ('checklist_supervision', 'punto_ronda', 'tarea_turno', 'orden_puntual', 'alerta') then
    raise exception 'Destino invalido' using errcode = '22023';
  end if;
  v_exist := public.protocolo_control_existente(v_c.objetivo_id, v_texto, v_c.id);

  update public.protocolo_controles_propuestos
     set destino = p_destino, texto_item = v_texto,
         criticidad = case when p_criticidad = 'alta' then 'alta' else 'normal' end,
         foto_obligatoria = coalesce(p_foto_obligatoria, false),
         existente_tipo = v_exist->>'tipo', existente_id = (v_exist->>'id')::uuid,
         existente_texto = v_exist->>'texto'
   where id = v_c.id;
  return jsonb_build_object('ok', true, 'existente', v_exist);
end;
$fn$;

revoke all on function public.protocolo_control_editar(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.protocolo_control_editar(uuid, text, text, text, boolean) to authenticated;

-- Aprobar: exige la clasificación validada por una persona (no informativa),
-- la instrucción vigente en el texto, y que no esté cubierta por algo que ya
-- existe. Aprobar NO activa nada.
create or replace function public.protocolo_control_aprobar(p_control_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c     public.protocolo_controles_propuestos%rowtype;
  v_ver   public.protocolo_versiones%rowtype;
  v_ins   public.protocolo_instrucciones%rowtype;
  v_exist jsonb;
begin
  v_c := (select c from public.protocolo_controles_propuestos c where c.id = p_control_id);
  if v_c.id is null then
    raise exception 'Control inexistente' using errcode = '22023';
  end if;
  v_ver := public.protocolo_version_para_preparar(v_c.version_id);
  if v_c.estado = 'aprobado' then
    return jsonb_build_object('ok', true, 'ya_aprobado', true);
  end if;
  if v_c.estado <> 'propuesto' then
    raise exception 'Solo se aprueba un control propuesto (esta %)', v_c.estado using errcode = '22023';
  end if;
  v_ins := (select i from public.protocolo_instrucciones i where i.id = v_c.instruccion_id);
  if v_ins.obsoleta_at is not null
     or v_ins.texto_sha256 <> encode(sha256(convert_to(public.protocolo_fragmento(v_ver.texto, v_ins.inicio, v_ins.fin), 'UTF8')), 'hex') then
    raise exception 'La instruccion ya no coincide con el texto del protocolo: volver a dividir' using errcode = '22023';
  end if;
  if v_ins.validada_at is null then
    raise exception 'Primero una persona tiene que validar la clasificacion de la instruccion' using errcode = '22023';
  end if;
  if v_ins.clasificacion = 'informativa' then
    raise exception 'Una instruccion informativa no genera controles' using errcode = '22023';
  end if;
  v_exist := public.protocolo_control_existente(v_c.objetivo_id, v_c.texto_item, v_c.id);
  if v_exist is not null then
    update public.protocolo_controles_propuestos
       set existente_tipo = v_exist->>'tipo', existente_id = (v_exist->>'id')::uuid, existente_texto = v_exist->>'texto'
     where id = v_c.id;
    raise exception 'Ya existe un control equivalente (%): rechazarlo como duplicado o corregir el texto', v_exist->>'texto'
      using errcode = '22023';
  end if;

  update public.protocolo_controles_propuestos
     set estado = 'aprobado', aprobado_por = public.rondas_usuario_actual_id(), aprobado_at = now(),
         existente_tipo = null, existente_id = null, existente_texto = null
   where id = v_c.id;
  return jsonb_build_object('ok', true, 'ya_aprobado', false);
end;
$fn$;

revoke all on function public.protocolo_control_aprobar(uuid) from public, anon;
grant execute on function public.protocolo_control_aprobar(uuid) to authenticated;

create or replace function public.protocolo_control_rechazar(p_control_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_c public.protocolo_controles_propuestos%rowtype;
begin
  v_c := (select c from public.protocolo_controles_propuestos c where c.id = p_control_id);
  if v_c.id is null then
    raise exception 'Control inexistente' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.protocolo_puede_preparar() or not public.protocolo_puede_ver(v_c.objetivo_id) then
    raise exception 'No tenes permiso para preparar protocolos' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'El rechazo necesita un motivo' using errcode = '22023';
  end if;
  if v_c.estado not in ('propuesto', 'aprobado') then
    raise exception 'Solo se rechaza un control propuesto o aprobado (esta %)', v_c.estado using errcode = '22023';
  end if;
  update public.protocolo_controles_propuestos
     set estado = 'rechazado', rechazado_por = public.rondas_usuario_actual_id(), rechazado_at = now(),
         motivo_rechazo = btrim(p_motivo)
   where id = v_c.id;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.protocolo_control_rechazar(uuid, text) from public, anon;
grant execute on function public.protocolo_control_rechazar(uuid, text) to authenticated;

-- ============================================================================
-- 11. RPC: ACTIVAR (sólo Gerencia, sólo checklist de supervisión)
-- ============================================================================
-- En una operación, para un objetivo:
--  · La plantilla asignada, si ya es propia del objetivo, se reutiliza.
--  · Si no, se crea una propia: copia de los ítems activos de la asignada (o
--    vacía si no tenía) y se asigna al objetivo. La genérica queda intacta y
--    las supervisiones viejas siguen apuntando a sus ítems.
--  · Cada control aprobado agrega un ítem con origen_instruccion_id. Si en la
--    plantilla ya hay un ítem con el mismo texto, se reutiliza ese ítem.
-- Exige: Gerencia, controles aprobados de checklist_supervision, del mismo
-- objetivo, de una versión VIGENTE y con la instrucción intacta.

create or replace function public.protocolo_controles_activar(p_objetivo_id uuid, p_control_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_usuario   uuid;
  v_obj       public.objetivos%rowtype;
  v_actual    public.checklist_plantillas%rowtype;
  v_plantilla uuid;
  v_creada    boolean := false;
  v_c         public.protocolo_controles_propuestos%rowtype;
  v_item      uuid;
  v_orden     integer;
  v_nuevos    integer := 0;
  v_reusados  integer := 0;
  v_cid       uuid;
begin
  if auth.uid() is null or not public.protocolo_puede_publicar() then
    raise exception 'Solo Gerencia activa controles del protocolo' using errcode = '42501';
  end if;
  if not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  if p_control_ids is null or cardinality(p_control_ids) = 0 then
    raise exception 'No hay controles para activar' using errcode = '22023';
  end if;
  v_usuario := public.rondas_usuario_actual_id();
  v_obj := (select o from public.objetivos o where o.id = p_objetivo_id for update);
  if v_obj.id is null then
    raise exception 'Objetivo inexistente' using errcode = '22023';
  end if;

  -- Validar todo antes de tocar nada.
  foreach v_cid in array p_control_ids loop
    v_c := (select c from public.protocolo_controles_propuestos c where c.id = v_cid for update);
    if v_c.id is null or v_c.objetivo_id <> p_objetivo_id then
      raise exception 'El control % no es de este objetivo', v_cid using errcode = '22023';
    end if;
    if v_c.estado <> 'aprobado' then
      raise exception 'Solo se activa lo aprobado (el control «%» esta %)', v_c.texto_item, v_c.estado using errcode = '22023';
    end if;
    if v_c.destino <> 'checklist_supervision' then
      raise exception 'En esta etapa solo se activan puntos del checklist de supervision («%» es %)', v_c.texto_item, v_c.destino
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.protocolo_versiones v
      join public.protocolo_instrucciones i on i.version_id = v.id
      where v.id = v_c.version_id and i.id = v_c.instruccion_id
        and v.estado = 'vigente' and i.obsoleta_at is null
        and i.texto_sha256 = encode(sha256(convert_to(public.protocolo_fragmento(v.texto, i.inicio, i.fin), 'UTF8')), 'hex')
    ) then
      raise exception 'El control «%» no sale de una version vigente del protocolo: publicar la version primero', v_c.texto_item
        using errcode = '22023';
    end if;
  end loop;

  -- Plantilla propia del objetivo.
  v_actual := (select p from public.checklist_plantillas p where p.id = v_obj.checklist_plantilla_id);
  if v_actual.id is not null and v_actual.objetivo_id = p_objetivo_id then
    v_plantilla := v_actual.id;
  else
    insert into public.checklist_plantillas (nombre, descripcion, activo, objetivo_id, copiada_de_plantilla_id)
    values (
      left(coalesce(v_obj.nombre, 'Objetivo'), 120) || ' · checklist del protocolo',
      case when v_actual.id is null
        then 'Plantilla propia del objetivo con los puntos aprobados de su protocolo.'
        else 'Copia de «' || v_actual.nombre || '» mas los puntos aprobados del protocolo del objetivo.' end,
      true, p_objetivo_id, v_actual.id
    ) returning id into v_plantilla;
    if v_actual.id is not null then
      insert into public.checklist_items (plantilla_id, texto, orden, obligatorio, criticidad, foto_obligatoria, activo)
      select v_plantilla, ci.texto, ci.orden, ci.obligatorio, ci.criticidad, ci.foto_obligatoria, true
      from public.checklist_items ci
      where ci.plantilla_id = v_actual.id and ci.activo;
    end if;
    update public.objetivos set checklist_plantilla_id = v_plantilla where id = p_objetivo_id;
    v_creada := true;
  end if;

  foreach v_cid in array p_control_ids loop
    v_c := (select c from public.protocolo_controles_propuestos c where c.id = v_cid);
    v_item := (select ci.id from public.checklist_items ci
               where ci.plantilla_id = v_plantilla and ci.activo
                 and public.protocolo_normalizar(ci.texto) = public.protocolo_normalizar(v_c.texto_item)
               order by ci.orden limit 1);
    if v_item is null then
      v_orden := (select coalesce(max(ci.orden), 0) + 1 from public.checklist_items ci where ci.plantilla_id = v_plantilla);
      insert into public.checklist_items (plantilla_id, texto, orden, obligatorio, criticidad, foto_obligatoria, activo, origen_instruccion_id)
      values (v_plantilla, v_c.texto_item, v_orden, true, v_c.criticidad, v_c.foto_obligatoria, true, v_c.instruccion_id)
      returning id into v_item;
      v_nuevos := v_nuevos + 1;
    else
      v_reusados := v_reusados + 1;
    end if;
    update public.protocolo_controles_propuestos
       set estado = 'activado', activado_por = v_usuario, activado_at = now(),
           plantilla_id = v_plantilla, checklist_item_id = v_item
     where id = v_c.id;
  end loop;

  return jsonb_build_object('ok', true, 'plantilla_id', v_plantilla, 'plantilla_creada', v_creada,
                            'items_nuevos', v_nuevos, 'items_reutilizados', v_reusados);
end;
$fn$;

revoke all on function public.protocolo_controles_activar(uuid, uuid[]) from public, anon;
grant execute on function public.protocolo_controles_activar(uuid, uuid[]) to authenticated;

-- ============================================================================
-- 12. RPC: PANEL DE LA FICHA
-- ============================================================================
-- Todo lo que muestra la sección «Checklist desde el protocolo» en un único
-- jsonb (PostgREST corta en 1000 filas). Versiones vigentes y en preparación.

create or replace function public.protocolo_controles_panel(p_objetivo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_plantilla uuid;
begin
  if auth.uid() is null or not public.protocolo_puede_ver(p_objetivo_id) then
    raise exception 'No tenes permiso sobre este objetivo' using errcode = '42501';
  end if;
  v_plantilla := (select o.checklist_plantilla_id from public.objetivos o where o.id = p_objetivo_id);

  return jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'permisos', jsonb_build_object(
      'preparar', public.protocolo_puede_preparar(),
      'activar', public.protocolo_puede_publicar()
    ),
    'plantilla', (
      select jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'propia', p.objetivo_id is not distinct from p_objetivo_id,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', ci.id, 'texto', ci.texto, 'orden', ci.orden, 'criticidad', ci.criticidad,
                     'foto_obligatoria', ci.foto_obligatoria, 'origen_instruccion_id', ci.origen_instruccion_id
                   ) order by ci.orden), '[]'::jsonb)
                  from public.checklist_items ci where ci.plantilla_id = p.id and ci.activo))
      from public.checklist_plantillas p where p.id = v_plantilla),
    'versiones', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', v.id, 'numero', v.numero, 'titulo', v.titulo, 'estado', v.estado,
          'puesto_id', v.puesto_id, 'puesto_nombre', pu.nombre,
          'instrucciones', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'orden', i.orden, 'inicio', i.inicio, 'fin', i.fin,
                'texto', public.protocolo_fragmento(v.texto, i.inicio, i.fin),
                'coincide', i.texto_sha256 = encode(sha256(convert_to(public.protocolo_fragmento(v.texto, i.inicio, i.fin), 'UTF8')), 'hex'),
                'clasificacion_ia', i.clasificacion_ia, 'quien_ia', i.quien_ia, 'cuando_ia', i.cuando_ia,
                'clasificacion', i.clasificacion, 'quien', i.quien, 'cuando', i.cuando,
                'validada_at', i.validada_at,
                'validada_por_nombre', nullif(btrim(coalesce(uv.nombre, '') || ' ' || coalesce(uv.apellido, '')), '')
              ) order by i.orden), '[]'::jsonb)
            from public.protocolo_instrucciones i
            left join public.usuarios uv on uv.id = i.validada_por
            where i.version_id = v.id and i.obsoleta_at is null)
        ) order by v.puesto_id nulls first, v.numero desc), '[]'::jsonb)
      from public.protocolo_versiones v
      left join public.puestos pu on pu.id = v.puesto_id
      where v.objetivo_id = p_objetivo_id
        and v.estado in ('borrador', 'pendiente_aprobacion', 'vigente')),
    'controles', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'instruccion_id', c.instruccion_id, 'version_id', c.version_id,
          'origen', c.origen, 'destino', c.destino, 'texto_original', c.texto_original,
          'texto_item', c.texto_item, 'criticidad', c.criticidad, 'foto_obligatoria', c.foto_obligatoria,
          'quien', c.quien, 'cuando', c.cuando, 'motivo', c.motivo,
          'existente_tipo', c.existente_tipo, 'existente_id', c.existente_id, 'existente_texto', c.existente_texto,
          'estado', c.estado, 'aprobado_at', c.aprobado_at,
          'aprobado_por_nombre', nullif(btrim(coalesce(ua.nombre, '') || ' ' || coalesce(ua.apellido, '')), ''),
          'rechazado_at', c.rechazado_at, 'motivo_rechazo', c.motivo_rechazo,
          'activado_at', c.activado_at,
          'activado_por_nombre', nullif(btrim(coalesce(uc.nombre, '') || ' ' || coalesce(uc.apellido, '')), ''),
          'checklist_item_id', c.checklist_item_id, 'creado_at', c.creado_at
        ) order by c.creado_at), '[]'::jsonb)
      from public.protocolo_controles_propuestos c
      left join public.usuarios ua on ua.id = c.aprobado_por
      left join public.usuarios uc on uc.id = c.activado_por
      where c.objetivo_id = p_objetivo_id),
    'corridas', (
      select coalesce(jsonb_agg(x.fila order by x.creado_at desc), '[]'::jsonb)
      from (
        select r.creado_at, jsonb_build_object(
          'id', r.id, 'version_id', r.version_id, 'modelo', r.modelo,
          'tokens_entrada', r.tokens_entrada, 'tokens_salida', r.tokens_salida,
          'instrucciones_enviadas', r.instrucciones_enviadas,
          'propuestas', (select count(*) from public.protocolo_controles_propuestos c where c.ia_corrida_id = r.id),
          'estado', r.estado, 'error', r.error, 'creado_at', r.creado_at
        ) as fila
        from public.protocolo_ia_corridas r
        where r.objetivo_id = p_objetivo_id
        order by r.creado_at desc
        limit 10
      ) x)
  );
end;
$fn$;

revoke all on function public.protocolo_controles_panel(uuid) from public, anon;
grant execute on function public.protocolo_controles_panel(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
