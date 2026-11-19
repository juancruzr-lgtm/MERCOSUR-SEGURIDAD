-- ═══════════════════════════════════════════════════════════════════════════
-- SIN APLICAR · requiere aprobación expresa de Gerencia
-- Ronda guiada: el vigilador marca dos puntos (extremos del puesto) y se crea
-- una ronda por defecto que queda PROPUESTA; empieza a regir sola a las 24 h
-- salvo que un supervisor/jefe la cambie o la rechace.
-- (lib/configuracion-guiada.ts · docs/gestion-empresarial/configuracion-guiada.md)
--
-- Qué hace:
--  - ronda_guiada: una solicitud por objetivo+puesto, con los dos puntos, el
--    estado y las fechas (propuesta, activa desde, fin de la semana de prueba).
--  - ronda_guiada_solicitar: un supervisor/jefe con permiso sobre el objetivo
--    pide al vigilador que marque los puntos.
--  - ronda_guiada_mi_pendiente / ronda_guiada_marcar_punto: el vigilador con
--    turno hoy o ayer en ese objetivo marca el punto 1 y el 2. Con el 2 se crea
--    rondas_base (activo = false) con 2 ronda_puntos GPS.
--  - ronda_guiada_decidir: activar ya o rechazar (con motivo).
--  - ronda_guiada_activar_vencidas: activa las propuestas que cumplieron 24 h y
--    NO fueron cambiadas (misma versión de rondas_base). Si alguien la cambió,
--    queda 'modificada' y la activa quien la cambió. Para el cron: NO se
--    programa ningún cron en esta migración.
--
-- Qué NO hace: no toca rondas existentes, ni la evaluación de vigiladores, ni
-- ronda_alertas. La exclusión de la semana de prueba en la evaluación se
-- conecta en la migración 20261122120000 (ventanas exigidas), aún sin aplicar.
-- Rollback: supabase/rollback/20261218120000_ronda_guiada_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.rondas_usuario_actual_id()') is null
     or to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') is null then
    raise exception 'Dependencias faltantes: rondas_usuario_actual_id / puede_administrar_rondas_objetivo';
  end if;
end $$;

create table public.ronda_guiada (
  id               uuid primary key default gen_random_uuid(),
  objetivo_id      uuid not null references public.objetivos(id),
  puesto_id        uuid not null,
  estado           text not null default 'esperando_puntos'
                   check (estado in ('esperando_puntos', 'propuesta', 'activa', 'modificada', 'rechazada')),
  intervalo_minutos integer not null default 120 check (intervalo_minutos between 15 and 1440),
  radio_metros     integer not null default 25 check (radio_metros between 10 and 100),
  solicitada_por   uuid not null references public.usuarios(id),
  solicitada_at    timestamptz not null default now(),
  p1_lat numeric, p1_lng numeric, p1_precision numeric, p1_at timestamptz,
  p2_lat numeric, p2_lng numeric, p2_precision numeric, p2_at timestamptz,
  distancia_metros numeric,
  capturada_por    uuid references public.usuarios(id),
  turno_id         uuid,
  ronda_base_id    uuid references public.rondas_base(id),
  version_propuesta integer,
  propuesta_at     timestamptz,
  activa_desde     timestamptz,
  prueba_hasta     timestamptz,
  activada_at      timestamptz,
  activada_por     uuid references public.usuarios(id),      -- null = activación automática
  rechazada_por    uuid references public.usuarios(id),
  rechazada_at     timestamptz,
  motivo_rechazo   text,
  check (estado <> 'rechazada' or (rechazada_por is not null and length(trim(coalesce(motivo_rechazo, ''))) > 0)),
  check (estado not in ('propuesta', 'activa', 'modificada') or (ronda_base_id is not null and propuesta_at is not null))
);
-- Una solicitud abierta por puesto.
create unique index ronda_guiada_abierta on public.ronda_guiada (puesto_id) where estado in ('esperando_puntos', 'propuesta');

alter table public.ronda_guiada enable row level security;
create policy "Ronda guiada: lee quien administra rondas del objetivo" on public.ronda_guiada
  for select to authenticated using (public.puede_administrar_rondas_objetivo(objetivo_id));
revoke insert, update, delete on public.ronda_guiada from authenticated, anon;
grant select on public.ronda_guiada to authenticated;

-- Distancia en metros (haversine), misma fórmula que lib/configuracion-guiada.ts
create or replace function public.ronda_guiada_distancia(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric)
returns numeric language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2)
    + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))
$$;

-- ── Pedir los puntos al vigilador ───────────────────────────────────────────
create or replace function public.ronda_guiada_solicitar(p_objetivo_id uuid, p_puesto_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_puesto uuid := p_puesto_id; v_id uuid;
begin
  if v_yo is null or not public.puede_administrar_rondas_objetivo(p_objetivo_id) then raise exception 'Sin permiso sobre las rondas de este objetivo'; end if;
  if v_puesto is null then
    select id into v_puesto from public.puestos where objetivo_id = p_objetivo_id order by id limit 1;
  end if;
  if v_puesto is null or not exists (select 1 from public.puestos where id = v_puesto and objetivo_id = p_objetivo_id) then
    raise exception 'El objetivo no tiene un puesto cargado';
  end if;
  select id into v_id from public.ronda_guiada where puesto_id = v_puesto and estado in ('esperando_puntos', 'propuesta');
  if v_id is not null then return v_id; end if;   -- idempotente
  insert into public.ronda_guiada (objetivo_id, puesto_id, solicitada_por) values (p_objetivo_id, v_puesto, v_yo) returning id into v_id;
  return v_id;
end $$;

-- ── Lo que ve el vigilador ──────────────────────────────────────────────────
create or replace function public.ronda_guiada_mi_pendiente()
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'objetivo_id', g.objetivo_id, 'objetivo', o.nombre, 'turno_id', t.id,
    'centro', case when o.lat is not null then jsonb_build_object('lat', o.lat, 'lng', o.lng) end,
    'punto1', case when g.p1_lat is not null then jsonb_build_object('lat', g.p1_lat, 'lng', g.p1_lng) end)), '[]'::jsonb)
  from public.ronda_guiada g
  join public.objetivos o on o.id = g.objetivo_id
  join lateral (
    select t.id from public.turnos t
    where t.objetivo_id = g.objetivo_id and t.guardia_id = public.rondas_usuario_actual_id()
      and t.fecha between (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1 and (now() at time zone 'America/Argentina/Buenos_Aires')::date
      and coalesce(t.estado, '') not in ('anulado', 'cancelado', 'reemplazado')
    order by t.fecha desc limit 1) t on true
  where g.estado = 'esperando_puntos'
$$;

-- ── El vigilador marca un punto ─────────────────────────────────────────────
create or replace function public.ronda_guiada_marcar_punto(p_id uuid, p_numero integer, p_lat numeric, p_lng numeric, p_precision numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_yo uuid := public.rondas_usuario_actual_id();
  v_g public.ronda_guiada;
  v_o public.objetivos;
  v_turno uuid;
  v_dist numeric;
  v_rb uuid;
  v_version integer;
begin
  if v_yo is null then raise exception 'Sin sesión'; end if;
  select * into v_g from public.ronda_guiada where id = p_id for update;
  if not found or v_g.estado <> 'esperando_puntos' then raise exception 'No hay una configuración de ronda pendiente'; end if;
  select t.id into v_turno from public.turnos t
   where t.objetivo_id = v_g.objetivo_id and t.guardia_id = v_yo
     and t.fecha between (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1 and (now() at time zone 'America/Argentina/Buenos_Aires')::date
     and coalesce(t.estado, '') not in ('anulado', 'cancelado', 'reemplazado')
   order by t.fecha desc limit 1;
  if v_turno is null then raise exception 'Sólo puede marcar los puntos quien tiene turno en este objetivo'; end if;
  if p_lat is null or p_lng is null then raise exception 'sin_gps'; end if;
  if p_precision is null or p_precision > 25 then raise exception 'impreciso'; end if;
  select * into v_o from public.objetivos where id = v_g.objetivo_id;
  if v_o.lat is not null and v_o.lng is not null and public.ronda_guiada_distancia(p_lat, p_lng, v_o.lat, v_o.lng) > 500 then
    raise exception 'lejos_del_objetivo';
  end if;

  if p_numero = 1 then
    update public.ronda_guiada set p1_lat = p_lat, p1_lng = p_lng, p1_precision = p_precision, p1_at = now(),
      p2_lat = null, p2_lng = null, p2_precision = null, p2_at = null, capturada_por = v_yo, turno_id = v_turno
    where id = p_id;
    return jsonb_build_object('ok', true, 'punto', 1);
  elsif p_numero <> 2 then
    raise exception 'Número de punto inválido';
  end if;

  if v_g.p1_lat is null then raise exception 'Primero marcá el punto 1'; end if;
  if v_g.capturada_por is distinct from v_yo then raise exception 'El punto 1 lo marcó otra persona: empezá de nuevo'; end if;
  v_dist := public.ronda_guiada_distancia(v_g.p1_lat, v_g.p1_lng, p_lat, p_lng);
  if v_dist < 20 then raise exception 'muy_cerca'; end if;
  if v_dist > 300 then raise exception 'muy_lejos'; end if;

  -- Ronda por defecto: inactiva hasta que se active (sola a las 24 h o a mano).
  insert into public.rondas_base (objetivo_id, puesto_id, nombre, descripcion, intervalo_minutos, activo)
  values (v_g.objetivo_id, v_g.puesto_id, 'Recorrida del puesto (guiada)',
          'Configurada por el vigilador en el lugar: ir de un extremo al otro del puesto.', v_g.intervalo_minutos, false)
  returning id into v_rb;
  insert into public.ronda_puntos (ronda_base_id, nombre, orden, gps_requerido, foto_requerida, latitud, longitud, precision_metros, radio_metros, activo, origen_posicion, posicion_capturada_at)
  values
    (v_rb, 'Extremo 1 del puesto', 1, true, false, v_g.p1_lat, v_g.p1_lng, v_g.p1_precision, v_g.radio_metros, true, 'gps', v_g.p1_at),
    (v_rb, 'Extremo 2 del puesto', 2, true, false, p_lat, p_lng, p_precision, v_g.radio_metros, true, 'gps', now());
  select version into v_version from public.rondas_base where id = v_rb;

  update public.ronda_guiada set p2_lat = p_lat, p2_lng = p_lng, p2_precision = p_precision, p2_at = now(),
    distancia_metros = round(v_dist), ronda_base_id = v_rb, version_propuesta = v_version, estado = 'propuesta',
    propuesta_at = now(), activa_desde = now() + interval '24 hours', prueba_hasta = now() + interval '24 hours' + interval '7 days'
  where id = p_id;
  return jsonb_build_object('ok', true, 'punto', 2, 'ronda_base_id', v_rb, 'distancia', round(v_dist));
end $$;

-- ── Supervisor / jefe: activar ya o rechazar ────────────────────────────────
create or replace function public.ronda_guiada_decidir(p_id uuid, p_accion text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_g public.ronda_guiada;
begin
  select * into v_g from public.ronda_guiada where id = p_id for update;
  if not found then raise exception 'Inexistente'; end if;
  if v_yo is null or not public.puede_administrar_rondas_objetivo(v_g.objetivo_id) then raise exception 'Sin permiso'; end if;
  if v_g.estado not in ('propuesta', 'esperando_puntos') then raise exception 'Ya no está pendiente (%).', v_g.estado; end if;
  if p_accion = 'activar_ya' then
    if v_g.estado <> 'propuesta' then raise exception 'Todavía no tiene los dos puntos'; end if;
    update public.rondas_base set activo = true where id = v_g.ronda_base_id;
    update public.ronda_guiada set estado = 'activa', activada_at = now(), activada_por = v_yo,
      prueba_hasta = now() + interval '7 days' where id = p_id;
  elsif p_accion = 'rechazar' then
    if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Falta el motivo'; end if;
    update public.ronda_guiada set estado = 'rechazada', rechazada_por = v_yo, rechazada_at = now(), motivo_rechazo = p_motivo where id = p_id;
    -- La ronda creada queda inactiva (no se borra: historial).
  else
    raise exception 'Acción inválida';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Activación automática (para el cron, cuando se apruebe) ─────────────────
create or replace function public.ronda_guiada_activar_vencidas()
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_activadas integer := 0; v_modificadas integer := 0; r record;
begin
  for r in
    select g.id, g.ronda_base_id, g.version_propuesta, rb.version, rb.activo
    from public.ronda_guiada g join public.rondas_base rb on rb.id = g.ronda_base_id
    where g.estado = 'propuesta' and g.activa_desde <= now()
    for update of g
  loop
    if r.version is distinct from r.version_propuesta or r.activo then
      update public.ronda_guiada set estado = 'modificada' where id = r.id;
      v_modificadas := v_modificadas + 1;
    else
      update public.rondas_base set activo = true where id = r.ronda_base_id;
      update public.ronda_guiada set estado = 'activa', activada_at = now() where id = r.id;
      v_activadas := v_activadas + 1;
    end if;
  end loop;
  return jsonb_build_object('activadas', v_activadas, 'modificadas', v_modificadas);
end $$;

revoke all on function public.ronda_guiada_solicitar(uuid, uuid) from public, anon;
revoke all on function public.ronda_guiada_mi_pendiente() from public, anon;
revoke all on function public.ronda_guiada_marcar_punto(uuid, integer, numeric, numeric, numeric) from public, anon;
revoke all on function public.ronda_guiada_decidir(uuid, text, text) from public, anon;
revoke all on function public.ronda_guiada_activar_vencidas() from public, anon, authenticated;
grant execute on function public.ronda_guiada_solicitar(uuid, uuid) to authenticated;
grant execute on function public.ronda_guiada_mi_pendiente() to authenticated;
grant execute on function public.ronda_guiada_marcar_punto(uuid, integer, numeric, numeric, numeric) to authenticated;
grant execute on function public.ronda_guiada_decidir(uuid, text, text) to authenticated;

commit;
