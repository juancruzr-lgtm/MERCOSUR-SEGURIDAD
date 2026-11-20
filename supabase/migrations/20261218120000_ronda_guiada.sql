-- ═══════════════════════════════════════════════════════════════════════════
-- Aplicada en producción el 19/11/2026 con autorización de Gerencia
-- Alta automática de protocolos y rondas (diseño aprobado el 19/11/2026).
-- (lib/configuracion-guiada.ts · docs/gestion-empresarial/configuracion-guiada.md)
--
-- RONDA
--  - El vigilador con turno hoy o ayer en el objetivo marca dos extremos del
--    puesto. Validación: precisión <= 30 m, cada punto dentro del área del
--    objetivo (radio + precisión + 25 m) y los dos puntos separados más que la
--    suma de sus precisiones (sin distancia mínima/máxima universal).
--  - Con el punto 2 válido se crea la ronda y queda ACTIVA en ese momento.
--    Frecuencia: objetivos.frecuencia_ronda_minutos o 120. No hay exigencias
--    hacia atrás: rondas_ventanas_programadas ya descarta toda ventana que
--    empiece antes de rondas_base.created_at.
--  - Si no se puede validar (GPS, no llega a un extremo), NO se crea ronda: la
--    solicitud queda 'requiere_revision' con el motivo, para supervisión.
--  - Supervisión puede desactivar con motivo; cambiar puntos/frecuencia sigue
--    por la edición de rondas existente (auditada).
--  - El pedido al vigilador sale cuando un supervisor lo solicita o, si
--    Gerencia enciende ronda_guiada_config.pedido_automatico, solo para
--    objetivos creados desde objetivos_desde (nunca para los ya existentes).
--
-- PROTOCOLO
--  - protocolo_guiado_enviar: el supervisor de la zona (o quien ya puede
--    preparar protocolos) crea la versión desde el formulario y la deja
--    'pendiente_aprobacion'. La aprueba quien puede preparar (Jefe de
--    supervisores, Dirección operativa, Gerencia) con protocolo_hacer_vigente,
--    ya existente; protocolo_guiado_devolver la devuelve con motivo.
--
-- Qué NO hace: no toca rondas ni protocolos existentes, ni la evaluación, ni
-- ronda_alertas. No envía avisos ni programa cron.
-- Rollback: supabase/rollback/20261218120000_ronda_guiada_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.rondas_usuario_actual_id()') is null
     or to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') is null
     or to_regprocedure('public.alcanza_objetivo(uuid,uuid)') is null
     or to_regprocedure('public.protocolo_puede_preparar()') is null then
    raise exception 'Dependencias faltantes: rondas_usuario_actual_id / puede_administrar_rondas_objetivo / alcanza_objetivo / protocolo_puede_preparar';
  end if;
end $$;

-- ── Frecuencia de ronda por objetivo (opcional) ─────────────────────────────
alter table public.objetivos add column if not exists frecuencia_ronda_minutos integer
  check (frecuencia_ronda_minutos is null or frecuencia_ronda_minutos between 15 and 1440);
comment on column public.objetivos.frecuencia_ronda_minutos is
  'Frecuencia inicial de la ronda configurada por el vigilador. Null = 120 minutos.';

-- ── Configuración (apagada) ─────────────────────────────────────────────────
create table public.ronda_guiada_config (
  id                  boolean primary key default true check (id),
  pedido_automatico   boolean not null default false,
  objetivos_desde     timestamptz,
  -- Gerencia, Director técnico y Jefe de supervisores (el supervisor de la zona se suma solo).
  avisar_usuarios     uuid[] not null default '{}',
  actualizado_por     uuid references public.usuarios(id),
  actualizado_at      timestamptz,
  check (not pedido_automatico or objetivos_desde is not null)
);
insert into public.ronda_guiada_config default values;

-- ── Solicitudes / configuraciones ───────────────────────────────────────────
create table public.ronda_guiada (
  id                uuid primary key default gen_random_uuid(),
  objetivo_id       uuid not null references public.objetivos(id),
  puesto_id         uuid not null,
  estado            text not null default 'esperando_puntos'
                    check (estado in ('esperando_puntos', 'activa', 'requiere_revision', 'desactivada')),
  origen            text not null check (origen in ('solicitud', 'automatico')),
  solicitada_por    uuid references public.usuarios(id),
  solicitada_at     timestamptz not null default now(),
  p1_lat numeric, p1_lng numeric, p1_precision numeric, p1_capturado_at timestamptz, p1_recibido_at timestamptz,
  p2_lat numeric, p2_lng numeric, p2_precision numeric, p2_capturado_at timestamptz, p2_recibido_at timestamptz,
  distancia_metros  numeric,
  frecuencia_minutos integer,
  capturada_por     uuid references public.usuarios(id),
  turno_id          uuid,
  ronda_base_id     uuid references public.rondas_base(id),
  activada_at       timestamptz,
  motivo_revision   text check (motivo_revision is null or motivo_revision in ('cerrado', 'no_puede_dejar_puesto', 'peligro_obra', 'gps', 'otro')),
  detalle_revision  text,
  revision_at       timestamptz,
  desactivada_por   uuid references public.usuarios(id),
  desactivada_at    timestamptz,
  motivo_desactivacion text,
  avisado_at        timestamptz,
  check (estado <> 'activa' or (ronda_base_id is not null and activada_at is not null and capturada_por is not null)),
  check (estado <> 'requiere_revision' or motivo_revision is not null),
  check (estado <> 'desactivada' or (desactivada_por is not null and length(trim(coalesce(motivo_desactivacion, ''))) > 0))
);
-- Una configuración abierta por puesto.
create unique index ronda_guiada_abierta on public.ronda_guiada (puesto_id) where estado in ('esperando_puntos', 'requiere_revision');

create table public.ronda_guiada_eventos (
  id         bigint generated always as identity primary key,
  guiada_id  uuid not null references public.ronda_guiada(id),
  accion     text not null,
  detalle    jsonb not null default '{}'::jsonb,
  actor_id   uuid references public.usuarios(id),
  at         timestamptz not null default now()
);
create or replace function public.ronda_guiada_eventos_inmutables() returns trigger language plpgsql as $$
begin raise exception 'ronda_guiada_eventos es de sólo agregado'; end $$;
create trigger ronda_guiada_eventos_inmutables before update or delete on public.ronda_guiada_eventos
  for each row execute function public.ronda_guiada_eventos_inmutables();

alter table public.ronda_guiada enable row level security;
alter table public.ronda_guiada_eventos enable row level security;
alter table public.ronda_guiada_config enable row level security;
create policy "Ronda guiada: lee quien administra rondas del objetivo" on public.ronda_guiada
  for select to authenticated using (public.puede_administrar_rondas_objetivo(objetivo_id));
create policy "Ronda guiada: eventos" on public.ronda_guiada_eventos
  for select to authenticated using (exists (select 1 from public.ronda_guiada g where g.id = guiada_id));
create policy "Ronda guiada: config" on public.ronda_guiada_config
  for select to authenticated using (public.protocolo_puede_preparar());
revoke insert, update, delete on public.ronda_guiada, public.ronda_guiada_eventos, public.ronda_guiada_config from authenticated, anon;
grant select on public.ronda_guiada, public.ronda_guiada_eventos, public.ronda_guiada_config to authenticated;

-- ── Utilidades ──────────────────────────────────────────────────────────────
create or replace function public.ronda_guiada_distancia(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric)
returns numeric language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2)
    + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))
$$;

-- Turno del usuario actual hoy o ayer en el objetivo (no anulado).
create or replace function public.ronda_guiada_mi_turno(p_objetivo_id uuid)
returns table (turno_id uuid, puesto_id uuid) language sql stable security definer set search_path = public, pg_catalog as $$
  select t.id, t.puesto_id from public.turnos t
  where t.objetivo_id = p_objetivo_id and t.guardia_id = public.rondas_usuario_actual_id()
    and t.fecha between (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1 and (now() at time zone 'America/Argentina/Buenos_Aires')::date
    and coalesce(t.estado, '') not in ('anulado', 'cancelado', 'reemplazado')
  order by t.fecha desc limit 1
$$;
revoke all on function public.ronda_guiada_mi_turno(uuid) from public, anon, authenticated;

-- ¿Corresponde pedirle la ronda al vigilador en este objetivo?
create or replace function public.ronda_guiada_corresponde(p_objetivo_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select not exists (select 1 from public.rondas_base rb where rb.objetivo_id = p_objetivo_id and rb.activo)
    and (
      exists (select 1 from public.ronda_guiada g where g.objetivo_id = p_objetivo_id and g.estado = 'esperando_puntos')
      or (
        exists (select 1 from public.ronda_guiada_config c join public.objetivos o on o.id = p_objetivo_id
                 where c.pedido_automatico and o.created_at >= c.objetivos_desde and coalesce(o.es_prueba, false) = false and o.estado = 'activo')
        and not exists (select 1 from public.ronda_guiada g where g.objetivo_id = p_objetivo_id and g.estado in ('requiere_revision', 'desactivada'))
      )
    )
$$;
revoke all on function public.ronda_guiada_corresponde(uuid) from public, anon, authenticated;

-- ── Supervisión pide la ronda ───────────────────────────────────────────────
create or replace function public.ronda_guiada_solicitar(p_objetivo_id uuid, p_puesto_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_puesto uuid := p_puesto_id; v_id uuid;
begin
  if v_yo is null or not public.puede_administrar_rondas_objetivo(p_objetivo_id) then raise exception 'Sin permiso sobre las rondas de este objetivo'; end if;
  if v_puesto is null then select id into v_puesto from public.puestos where objetivo_id = p_objetivo_id order by id limit 1; end if;
  if v_puesto is null or not exists (select 1 from public.puestos where id = v_puesto and objetivo_id = p_objetivo_id) then
    raise exception 'El objetivo no tiene un puesto cargado';
  end if;
  select id into v_id from public.ronda_guiada where puesto_id = v_puesto and estado in ('esperando_puntos', 'requiere_revision') for update;
  if v_id is not null then
    -- Volver a pedir después de una revisión: se limpia y se pide de nuevo.
    update public.ronda_guiada set estado = 'esperando_puntos', motivo_revision = null, detalle_revision = null,
      p1_lat = null, p1_lng = null, p1_precision = null, p1_capturado_at = null, p1_recibido_at = null where id = v_id;
  else
    insert into public.ronda_guiada (objetivo_id, puesto_id, origen, solicitada_por) values (p_objetivo_id, v_puesto, 'solicitud', v_yo) returning id into v_id;
  end if;
  insert into public.ronda_guiada_eventos (guiada_id, accion, actor_id) values (v_id, 'solicitada', v_yo);
  return v_id;
end $$;

-- ── Lo que ve el vigilador ──────────────────────────────────────────────────
create or replace function public.ronda_guiada_mi_pendiente()
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'objetivo_id', o.id, 'objetivo', o.nombre,
    'area', jsonb_build_object('lat', o.lat, 'lng', o.lng, 'radio_metros', o.radio_metros),
    'frecuencia_minutos', coalesce(o.frecuencia_ronda_minutos, 120),
    'punto1', (select case when g.p1_lat is not null then jsonb_build_object('lat', g.p1_lat, 'lng', g.p1_lng, 'precision', g.p1_precision) end
               from public.ronda_guiada g where g.objetivo_id = o.id and g.estado = 'esperando_puntos' and g.capturada_por = public.rondas_usuario_actual_id() limit 1))), '[]'::jsonb)
  from public.objetivos o
  where exists (select 1 from public.ronda_guiada_mi_turno(o.id))
    and public.ronda_guiada_corresponde(o.id)
$$;

-- ── El vigilador marca un punto ─────────────────────────────────────────────
-- p_capturado_at: hora real en que se marcó (puede llegar más tarde si no había señal).
create or replace function public.ronda_guiada_marcar_punto(p_objetivo_id uuid, p_numero integer, p_lat numeric, p_lng numeric, p_precision numeric, p_capturado_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_yo uuid := public.rondas_usuario_actual_id();
  v_turno record;
  v_g public.ronda_guiada;
  v_o public.objetivos;
  v_cap timestamptz := least(coalesce(p_capturado_at, now()), now());
  v_dist numeric; v_min numeric; v_area numeric;
  v_rb uuid; v_freq integer;
begin
  if v_yo is null then raise exception 'Sin sesión'; end if;
  select * into v_turno from public.ronda_guiada_mi_turno(p_objetivo_id);
  if v_turno.turno_id is null then raise exception 'Sólo puede marcar los puntos quien tiene turno en este objetivo'; end if;
  if not public.ronda_guiada_corresponde(p_objetivo_id) then raise exception 'Este objetivo no tiene una configuración de ronda pendiente'; end if;
  if v_cap < now() - interval '36 hours' then raise exception 'El punto se marcó hace demasiado: volvé a marcarlo'; end if;
  if p_lat is null or p_lng is null then raise exception 'sin_gps'; end if;
  if p_precision is null or p_precision > 30 then raise exception 'impreciso'; end if;
  select * into v_o from public.objetivos where id = p_objetivo_id;
  if v_o.lat is not null and v_o.lng is not null then
    v_area := coalesce(nullif(v_o.radio_metros, 0), 100) + p_precision + 25;
    if public.ronda_guiada_distancia(p_lat, p_lng, v_o.lat, v_o.lng) > v_area then raise exception 'fuera_del_objetivo'; end if;
  end if;

  -- Fila de trabajo: la solicitada o una automática nueva.
  select * into v_g from public.ronda_guiada where objetivo_id = p_objetivo_id and estado = 'esperando_puntos' order by solicitada_at limit 1 for update;
  if v_g.id is null then
    insert into public.ronda_guiada (objetivo_id, puesto_id, origen)
    values (p_objetivo_id, coalesce(v_turno.puesto_id, (select id from public.puestos where objetivo_id = p_objetivo_id order by id limit 1)), 'automatico')
    returning * into v_g;
    if v_g.puesto_id is null then raise exception 'El objetivo no tiene un puesto cargado'; end if;
  end if;

  if p_numero = 1 then
    update public.ronda_guiada set p1_lat = p_lat, p1_lng = p_lng, p1_precision = p_precision, p1_capturado_at = v_cap, p1_recibido_at = now(),
      capturada_por = v_yo, turno_id = v_turno.turno_id where id = v_g.id;
    insert into public.ronda_guiada_eventos (guiada_id, accion, detalle, actor_id)
      values (v_g.id, 'punto_1', jsonb_build_object('precision', p_precision, 'capturado_at', v_cap), v_yo);
    return jsonb_build_object('ok', true, 'punto', 1);
  elsif p_numero <> 2 then
    raise exception 'Número de punto inválido';
  end if;

  if v_g.p1_lat is null or v_g.capturada_por is distinct from v_yo then raise exception 'Primero marcá el punto 1'; end if;
  v_dist := public.ronda_guiada_distancia(v_g.p1_lat, v_g.p1_lng, p_lat, p_lng);
  v_min := greatest(1, v_g.p1_precision + p_precision);
  if v_dist <= v_min then raise exception 'indistinguible: % m, hacen falta más de % m', round(v_dist), round(v_min); end if;

  v_freq := coalesce(v_o.frecuencia_ronda_minutos, 120);
  -- La ronda nace inactiva (el control de producción exige puntos para activar)
  -- y se activa apenas tiene los dos puntos: created_at = momento de activación.
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, descripcion, intervalo_minutos, activo)
  values (p_objetivo_id, v_g.puesto_id, 'Recorrida del puesto',
          'Configurada por el vigilador en el lugar: ir de un extremo al otro del puesto.', v_freq, false)
  returning id into v_rb;
  insert into public.ronda_puntos (ronda_base_id, nombre, orden, gps_requerido, foto_requerida, latitud, longitud, precision_metros, radio_metros, activo, origen_posicion, posicion_capturada_at)
  values
    (v_rb, 'Extremo 1 del puesto', 1, true, false, v_g.p1_lat, v_g.p1_lng, v_g.p1_precision, greatest(25, ceil(v_g.p1_precision * 2)), true, 'gps', v_g.p1_capturado_at),
    (v_rb, 'Extremo 2 del puesto', 2, true, false, p_lat, p_lng, p_precision, greatest(25, ceil(p_precision * 2)), true, 'gps', v_cap);
  update public.rondas_base set activo = true where id = v_rb;

  update public.ronda_guiada set p2_lat = p_lat, p2_lng = p_lng, p2_precision = p_precision, p2_capturado_at = v_cap, p2_recibido_at = now(),
    distancia_metros = round(v_dist), frecuencia_minutos = v_freq, ronda_base_id = v_rb, estado = 'activa', activada_at = now()
  where id = v_g.id;
  insert into public.ronda_guiada_eventos (guiada_id, accion, detalle, actor_id)
    values (v_g.id, 'activada', jsonb_build_object('precision', p_precision, 'distancia', round(v_dist), 'frecuencia', v_freq, 'ronda_base_id', v_rb), v_yo);
  return jsonb_build_object('ok', true, 'punto', 2, 'ronda_base_id', v_rb, 'distancia', round(v_dist), 'frecuencia_minutos', v_freq, 'activada_at', now());
end $$;

-- ── El vigilador informa que no puede completar ─────────────────────────────
create or replace function public.ronda_guiada_reportar_problema(p_objetivo_id uuid, p_motivo text, p_detalle text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_turno record; v_id uuid;
begin
  select * into v_turno from public.ronda_guiada_mi_turno(p_objetivo_id);
  if v_yo is null or v_turno.turno_id is null then raise exception 'Sólo quien tiene turno en este objetivo'; end if;
  if p_motivo not in ('cerrado', 'no_puede_dejar_puesto', 'peligro_obra', 'gps', 'otro') then raise exception 'Motivo inválido'; end if;
  if not public.ronda_guiada_corresponde(p_objetivo_id) then raise exception 'Este objetivo no tiene una configuración de ronda pendiente'; end if;
  select id into v_id from public.ronda_guiada where objetivo_id = p_objetivo_id and estado = 'esperando_puntos' limit 1 for update;
  if v_id is null then
    insert into public.ronda_guiada (objetivo_id, puesto_id, origen, estado, motivo_revision, detalle_revision, revision_at, capturada_por, turno_id)
    values (p_objetivo_id, coalesce(v_turno.puesto_id, (select id from public.puestos where objetivo_id = p_objetivo_id order by id limit 1)),
            'automatico', 'requiere_revision', p_motivo, nullif(trim(p_detalle), ''), now(), v_yo, v_turno.turno_id)
    returning id into v_id;
  else
    update public.ronda_guiada set estado = 'requiere_revision', motivo_revision = p_motivo, detalle_revision = nullif(trim(p_detalle), ''),
      revision_at = now(), capturada_por = v_yo, turno_id = v_turno.turno_id where id = v_id;
  end if;
  insert into public.ronda_guiada_eventos (guiada_id, accion, detalle, actor_id) values (v_id, 'requiere_revision', jsonb_build_object('motivo', p_motivo), v_yo);
  return jsonb_build_object('ok', true);
end $$;

-- ── Supervisión desactiva una configuración incorrecta ──────────────────────
create or replace function public.ronda_guiada_desactivar(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_g public.ronda_guiada;
begin
  select * into v_g from public.ronda_guiada where id = p_id for update;
  if not found then raise exception 'Inexistente'; end if;
  if v_yo is null or not public.puede_administrar_rondas_objetivo(v_g.objetivo_id) then raise exception 'Sin permiso'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Falta el motivo'; end if;
  if v_g.estado = 'desactivada' then return jsonb_build_object('ok', true, 'ya', true); end if;
  if v_g.ronda_base_id is not null then update public.rondas_base set activo = false where id = v_g.ronda_base_id; end if;
  update public.ronda_guiada set estado = 'desactivada', desactivada_por = v_yo, desactivada_at = now(), motivo_desactivacion = p_motivo where id = p_id;
  insert into public.ronda_guiada_eventos (guiada_id, accion, detalle, actor_id) values (p_id, 'desactivada', jsonb_build_object('motivo', p_motivo), v_yo);
  return jsonb_build_object('ok', true);
end $$;

-- ── Protocolo guiado: el supervisor de zona lo envía a aprobación ───────────
create or replace function public.protocolo_guiado_enviar(p_objetivo_id uuid, p_titulo text, p_texto text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_numero integer; v_id uuid;
begin
  if v_yo is null then raise exception 'Sin sesión'; end if;
  if not (public.protocolo_puede_preparar()
          or (exists (select 1 from public.usuarios u where u.id = v_yo and u.puesto_organizacional = 'supervisor')
              and public.alcanza_objetivo(v_yo, p_objetivo_id))) then
    raise exception 'Sólo el supervisor de la zona o quien prepara protocolos';
  end if;
  if coalesce(btrim(p_texto), '') = '' or coalesce(btrim(p_titulo), '') = '' then raise exception 'Titulo y texto son obligatorios'; end if;
  if exists (select 1 from public.protocolo_versiones v where v.objetivo_id = p_objetivo_id and v.puesto_id is null and v.estado = 'pendiente_aprobacion') then
    raise exception 'Ya hay un protocolo de este objetivo esperando aprobación';
  end if;
  perform pg_advisory_xact_lock(hashtext('protocolo:' || p_objetivo_id::text));
  v_numero := coalesce((select max(v.numero) from public.protocolo_versiones v where v.objetivo_id = p_objetivo_id and v.puesto_id is null), 0) + 1;
  -- Producción exige que toda versión nazca como borrador (trg_protocolo_version_proteger):
  -- se crea en borrador y se pasa a pendiente de aprobación en la misma transacción.
  insert into public.protocolo_versiones (objetivo_id, puesto_id, numero, titulo, texto, texto_sha256, fuente_tipo, fuente_descripcion,
    asociacion, asociacion_confirmada_por, asociacion_confirmada_at, estado, creado_por)
  values (p_objetivo_id, null, v_numero, btrim(p_titulo), p_texto, repeat('0', 64), 'manual', 'Formulario guiado del supervisor de zona',
    'confirmada', v_yo, now(), 'borrador', v_yo)
  returning id into v_id;
  update public.protocolo_versiones set estado = 'pendiente_aprobacion', enviado_aprobacion_por = v_yo, enviado_aprobacion_at = now()
  where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
end $$;

-- Devolver con motivo (lo puede hacer quien aprueba; la función existente sólo la permite a Gerencia).
create or replace function public.protocolo_guiado_devolver(p_version_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_estado text;
begin
  if not public.protocolo_puede_preparar() then raise exception 'Sin permiso para aprobar protocolos'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Falta el motivo'; end if;
  select estado into v_estado from public.protocolo_versiones where id = p_version_id for update;
  if v_estado is distinct from 'pendiente_aprobacion' then raise exception 'Sólo se devuelve un protocolo pendiente de aprobación'; end if;
  update public.protocolo_versiones set estado = 'borrador', devuelto_motivo = p_motivo where id = p_version_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.ronda_guiada_solicitar(uuid, uuid) from public, anon;
revoke all on function public.ronda_guiada_mi_pendiente() from public, anon;
revoke all on function public.ronda_guiada_marcar_punto(uuid, integer, numeric, numeric, numeric, timestamptz) from public, anon;
revoke all on function public.ronda_guiada_reportar_problema(uuid, text, text) from public, anon;
revoke all on function public.ronda_guiada_desactivar(uuid, text) from public, anon;
revoke all on function public.protocolo_guiado_enviar(uuid, text, text) from public, anon;
revoke all on function public.protocolo_guiado_devolver(uuid, text) from public, anon;
grant execute on function public.ronda_guiada_solicitar(uuid, uuid) to authenticated;
grant execute on function public.ronda_guiada_mi_pendiente() to authenticated;
grant execute on function public.ronda_guiada_marcar_punto(uuid, integer, numeric, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.ronda_guiada_reportar_problema(uuid, text, text) to authenticated;
grant execute on function public.ronda_guiada_desactivar(uuid, text) to authenticated;
grant execute on function public.protocolo_guiado_enviar(uuid, text, text) to authenticated;
grant execute on function public.protocolo_guiado_devolver(uuid, text) to authenticated;

commit;
