-- ═══════════════════════════════════════════════════════════════════════════
-- GPS · Vehículos de supervisión con Smart Tag (HTAG / TagX, red Google Find Hub)
--
-- NO APLICAR SIN APROBACIÓN EXPRESA. Rollback: supabase/rollback/20261215100000_gps_vehiculos_smart_tags_rollback.sql
-- Verificación: supabase/verificacion/20261215100000_gps_vehiculos_smart_tags.sql
--
-- Qué agrega (todo nuevo; no toca el GPS de teléfonos):
--   gps_tags                          dispositivos Smart Tag (sin credenciales)
--   gps_vehiculos                     vehículos de supervisión (identificador + patente)
--   gps_vehiculo_tag_asignaciones     qué tag lleva cada vehículo, con historia
--   gps_vehiculo_supervisor_asign.    qué supervisor usa cada vehículo, con historia
--   gps_tag_consultas                 cada consulta al servicio (hora de consulta, resultado, error)
--   gps_tag_posiciones                posiciones REALES devueltas por el servicio (hora de ubicación)
--   gps_vehiculos_accesos             registro de accesos administrativos al historial
--
-- Separación de fuentes: las posiciones de teléfonos siguen en
-- `supervisor_route_points`. Las de Smart Tag viven SÓLO en `gps_tag_posiciones`
-- con `fuente` explícita ('google_find_hub' | 'simulado'). Nunca se mezclan.
--
-- Atribución: cada posición guarda el vehículo y el supervisor vigentes EN LA HORA
-- DE UBICACIÓN (no en la de consulta ni la actual). Reasignar un vehículo no
-- cambia a quién se atribuyeron recorridos anteriores.
--
-- Credenciales: ninguna tabla guarda contraseñas, tokens ni claves de Google.
--
-- Acceso: lectura y gestión sólo Gerencia (o delegación gerencial vigente).
-- Las posiciones y consultas sólo las escribe el servicio (service_role) vía
-- `gps_tag_registrar_consulta`; el navegador no puede insertarlas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Permisos ────────────────────────────────────────────────────────────────
create or replace function public.gps_vehiculos_puede_ver_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.acceso_habilitado_actual() and public.puede_acceder_gerencia_actual()
$fn$;
revoke all on function public.gps_vehiculos_puede_ver_actual() from public, anon;
grant execute on function public.gps_vehiculos_puede_ver_actual() to authenticated;

-- Hoy gestionar = ver (sólo Gerencia). Separada para poder abrirla por separado.
create or replace function public.gps_vehiculos_puede_gestionar_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.gps_vehiculos_puede_ver_actual()
$fn$;
revoke all on function public.gps_vehiculos_puede_gestionar_actual() from public, anon;
grant execute on function public.gps_vehiculos_puede_gestionar_actual() to authenticated;

create or replace function public.gps_usuario_actual_id()
returns uuid language sql stable security definer set search_path = public, pg_catalog as $fn$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() limit 1
$fn$;
revoke all on function public.gps_usuario_actual_id() from public, anon, authenticated;

-- ── Tablas ──────────────────────────────────────────────────────────────────
create table public.gps_tags (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 1 and 80),
  modelo text not null default 'HTAG (TagX)',
  proveedor text not null check (proveedor in ('google_find_hub', 'simulado')),
  -- Identificador del dispositivo en el proveedor (p. ej. canonic id de Find Hub).
  -- NO es una credencial. Nunca guardar acá tokens ni claves.
  identificador_externo text,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo', 'baja')),
  es_prueba boolean not null default false,
  notas text,
  creado_en timestamptz not null default now(),
  creado_por uuid references public.usuarios(id),
  unique (proveedor, identificador_externo)
);

create table public.gps_vehiculos (
  id uuid primary key default gen_random_uuid(),
  identificador text not null unique check (length(trim(identificador)) between 1 and 40),
  patente text not null check (patente ~ '^[A-Z0-9]{5,10}$'),
  descripcion text,
  estado text not null default 'activo' check (estado in ('activo', 'fuera_de_servicio', 'baja')),
  creado_en timestamptz not null default now(),
  creado_por uuid references public.usuarios(id)
);
create unique index gps_vehiculos_patente_uq on public.gps_vehiculos (patente);

create table public.gps_vehiculo_tag_asignaciones (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references public.gps_vehiculos(id),
  tag_id uuid not null references public.gps_tags(id),
  desde timestamptz not null default now(),
  hasta timestamptz,
  motivo text,
  creado_por uuid references public.usuarios(id),
  check (hasta is null or hasta > desde)
);
-- Un tag activo por vehículo y un vehículo activo por tag.
create unique index gps_vta_vehiculo_vigente_uq on public.gps_vehiculo_tag_asignaciones (vehiculo_id) where hasta is null;
create unique index gps_vta_tag_vigente_uq on public.gps_vehiculo_tag_asignaciones (tag_id) where hasta is null;
create index gps_vta_tag_rango_idx on public.gps_vehiculo_tag_asignaciones (tag_id, desde);

create table public.gps_vehiculo_supervisor_asignaciones (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references public.gps_vehiculos(id),
  supervisor_id uuid not null references public.usuarios(id),
  desde timestamptz not null default now(),
  hasta timestamptz,
  motivo text,
  creado_por uuid references public.usuarios(id),
  check (hasta is null or hasta > desde)
);
create unique index gps_vsa_vehiculo_vigente_uq on public.gps_vehiculo_supervisor_asignaciones (vehiculo_id) where hasta is null;
create index gps_vsa_vehiculo_rango_idx on public.gps_vehiculo_supervisor_asignaciones (vehiculo_id, desde);

create table public.gps_tag_consultas (
  id bigint generated always as identity primary key,
  tag_id uuid not null references public.gps_tags(id),
  proveedor text not null check (proveedor in ('google_find_hub', 'simulado')),
  hora_consulta timestamptz not null,
  duracion_ms integer check (duracion_ms is null or duracion_ms >= 0),
  intentos smallint not null default 1 check (intentos between 1 and 10),
  resultado text not null check (resultado in ('nueva_posicion', 'sin_novedad', 'sin_datos', 'error', 'omitida_limite')),
  posiciones_recibidas integer not null default 0 check (posiciones_recibidas >= 0),
  posiciones_nuevas integer not null default 0 check (posiciones_nuevas >= 0),
  error_codigo text,
  error_detalle text check (error_detalle is null or length(error_detalle) <= 500),
  registrado_en timestamptz not null default now()
);
create index gps_tag_consultas_tag_hora_idx on public.gps_tag_consultas (tag_id, hora_consulta desc);

create table public.gps_tag_posiciones (
  id bigint generated always as identity primary key,
  tag_id uuid not null references public.gps_tags(id),
  fuente text not null check (fuente in ('google_find_hub', 'simulado')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  precision_m double precision check (precision_m is null or precision_m >= 0),
  -- Momento en que el dispositivo fue detectado realmente (lo informa el servicio).
  hora_ubicacion timestamptz not null,
  -- Momento en que MERCOSUR consultó el servicio y recibió esta posición por primera vez.
  hora_consulta timestamptz not null,
  consulta_id bigint references public.gps_tag_consultas(id),
  -- Atribución congelada en la hora de ubicación.
  vehiculo_id uuid references public.gps_vehiculos(id),
  supervisor_id uuid references public.usuarios(id),
  registrado_en timestamptz not null default now(),
  check (hora_ubicacion <= hora_consulta + interval '5 minutes')
);
-- Evita duplicar la misma posición con la misma marca temporal.
create unique index gps_tag_posiciones_dedup_uq on public.gps_tag_posiciones (tag_id, hora_ubicacion, lat, lng);
create index gps_tag_posiciones_vehiculo_hora_idx on public.gps_tag_posiciones (vehiculo_id, hora_ubicacion desc);
create index gps_tag_posiciones_tag_hora_idx on public.gps_tag_posiciones (tag_id, hora_ubicacion desc);

create table public.gps_vehiculos_accesos (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.usuarios(id),
  accion text not null check (accion in ('ver_listado', 'ver_historial', 'ver_prueba', 'gestionar')),
  vehiculo_id uuid references public.gps_vehiculos(id),
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index gps_vehiculos_accesos_creado_idx on public.gps_vehiculos_accesos (creado_en desc);

-- ── RLS: lectura Gerencia; escritura sólo por RPC ───────────────────────────
alter table public.gps_tags enable row level security;
alter table public.gps_vehiculos enable row level security;
alter table public.gps_vehiculo_tag_asignaciones enable row level security;
alter table public.gps_vehiculo_supervisor_asignaciones enable row level security;
alter table public.gps_tag_consultas enable row level security;
alter table public.gps_tag_posiciones enable row level security;
alter table public.gps_vehiculos_accesos enable row level security;

revoke all on public.gps_tags, public.gps_vehiculos, public.gps_vehiculo_tag_asignaciones,
  public.gps_vehiculo_supervisor_asignaciones, public.gps_tag_consultas, public.gps_tag_posiciones,
  public.gps_vehiculos_accesos from anon, authenticated;
grant select on public.gps_tags, public.gps_vehiculos, public.gps_vehiculo_tag_asignaciones,
  public.gps_vehiculo_supervisor_asignaciones, public.gps_tag_consultas, public.gps_tag_posiciones,
  public.gps_vehiculos_accesos to authenticated;

create policy gps_tags_lectura on public.gps_tags for select to authenticated using (public.gps_vehiculos_puede_ver_actual());
create policy gps_vehiculos_lectura on public.gps_vehiculos for select to authenticated using (public.gps_vehiculos_puede_ver_actual());
create policy gps_vta_lectura on public.gps_vehiculo_tag_asignaciones for select to authenticated using (public.gps_vehiculos_puede_ver_actual());
create policy gps_vsa_lectura on public.gps_vehiculo_supervisor_asignaciones for select to authenticated using (public.gps_vehiculos_puede_ver_actual());
create policy gps_tag_consultas_lectura on public.gps_tag_consultas for select to authenticated using (public.gps_vehiculos_puede_ver_actual());
create policy gps_tag_posiciones_lectura on public.gps_tag_posiciones for select to authenticated using (public.gps_vehiculos_puede_ver_actual());
create policy gps_vehiculos_accesos_lectura on public.gps_vehiculos_accesos for select to authenticated using (public.gps_vehiculos_puede_ver_actual());

-- ── RPC de gestión (Gerencia) ───────────────────────────────────────────────
create or replace function public.gps_tag_guardar(
  p_id uuid, p_nombre text, p_proveedor text, p_identificador_externo text,
  p_estado text default 'activo', p_es_prueba boolean default false, p_notas text default null
) returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_id uuid; v_ext text := nullif(trim(coalesce(p_identificador_externo, '')), '');
begin
  if not public.gps_vehiculos_puede_gestionar_actual() then
    raise exception 'Sin permiso para gestionar Smart Tags' using errcode = '42501';
  end if;
  -- Defensa: un identificador no puede parecer un token/credencial.
  if v_ext is not null and (length(v_ext) > 128 or v_ext ~* '(token|secret|password|oauth|aas_)') then
    raise exception 'El identificador externo no puede contener credenciales' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.gps_tags (nombre, proveedor, identificador_externo, estado, es_prueba, notas, creado_por)
    values (trim(p_nombre), p_proveedor, v_ext, p_estado, coalesce(p_es_prueba, false), p_notas, public.gps_usuario_actual_id())
    returning id into v_id;
  else
    update public.gps_tags set nombre = trim(p_nombre), proveedor = p_proveedor, identificador_externo = v_ext,
      estado = p_estado, es_prueba = coalesce(p_es_prueba, false), notas = p_notas
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Smart Tag inexistente' using errcode = 'P0002'; end if;
  end if;
  insert into public.gps_vehiculos_accesos (usuario_id, accion, detalle)
  values (public.gps_usuario_actual_id(), 'gestionar', jsonb_build_object('op', 'tag_guardar', 'tag_id', v_id));
  return v_id;
end $fn$;

create or replace function public.gps_vehiculo_guardar(
  p_id uuid, p_identificador text, p_patente text, p_descripcion text default null, p_estado text default 'activo'
) returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_id uuid; v_patente text := upper(regexp_replace(coalesce(p_patente, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.gps_vehiculos_puede_gestionar_actual() then
    raise exception 'Sin permiso para gestionar vehículos' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.gps_vehiculos (identificador, patente, descripcion, estado, creado_por)
    values (trim(p_identificador), v_patente, p_descripcion, p_estado, public.gps_usuario_actual_id())
    returning id into v_id;
  else
    update public.gps_vehiculos set identificador = trim(p_identificador), patente = v_patente,
      descripcion = p_descripcion, estado = p_estado
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Vehículo inexistente' using errcode = 'P0002'; end if;
  end if;
  insert into public.gps_vehiculos_accesos (usuario_id, accion, vehiculo_id, detalle)
  values (public.gps_usuario_actual_id(), 'gestionar', v_id, jsonb_build_object('op', 'vehiculo_guardar'));
  return v_id;
end $fn$;

-- Asigna (o quita, con p_tag_id null) el tag de un vehículo. Cierra la vigente; conserva historia.
create or replace function public.gps_vehiculo_asignar_tag(p_vehiculo_id uuid, p_tag_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_ahora timestamptz := now();
begin
  if not public.gps_vehiculos_puede_gestionar_actual() then
    raise exception 'Sin permiso para asignar Smart Tags' using errcode = '42501';
  end if;
  perform 1 from public.gps_vehiculos where id = p_vehiculo_id for update;
  if not found then raise exception 'Vehículo inexistente' using errcode = 'P0002'; end if;
  -- Idempotente: si ya es la vigente, no hace nada.
  if p_tag_id is not null and exists (select 1 from public.gps_vehiculo_tag_asignaciones
      where vehiculo_id = p_vehiculo_id and tag_id = p_tag_id and hasta is null) then
    return;
  end if;
  update public.gps_vehiculo_tag_asignaciones set hasta = v_ahora
   where hasta is null and (vehiculo_id = p_vehiculo_id or (p_tag_id is not null and tag_id = p_tag_id));
  if p_tag_id is not null then
    insert into public.gps_vehiculo_tag_asignaciones (vehiculo_id, tag_id, desde, motivo, creado_por)
    values (p_vehiculo_id, p_tag_id, v_ahora, p_motivo, public.gps_usuario_actual_id());
  end if;
  insert into public.gps_vehiculos_accesos (usuario_id, accion, vehiculo_id, detalle)
  values (public.gps_usuario_actual_id(), 'gestionar', p_vehiculo_id, jsonb_build_object('op', 'asignar_tag', 'tag_id', p_tag_id));
end $fn$;

-- Asigna (o deja sin asignar, con p_supervisor_id null) el supervisor del vehículo.
create or replace function public.gps_vehiculo_asignar_supervisor(p_vehiculo_id uuid, p_supervisor_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_ahora timestamptz := now();
begin
  if not public.gps_vehiculos_puede_gestionar_actual() then
    raise exception 'Sin permiso para asignar supervisores a vehículos' using errcode = '42501';
  end if;
  perform 1 from public.gps_vehiculos where id = p_vehiculo_id for update;
  if not found then raise exception 'Vehículo inexistente' using errcode = 'P0002'; end if;
  if p_supervisor_id is not null and not exists (
      select 1 from public.usuarios u where u.id = p_supervisor_id and u.estado = 'activo'
        and (u.puesto_organizacional in ('supervisor', 'jefe_supervisores') or lower(u.rol) = 'supervisor')) then
    raise exception 'El usuario no es un supervisor activo' using errcode = '22023';
  end if;
  if p_supervisor_id is not null and exists (select 1 from public.gps_vehiculo_supervisor_asignaciones
      where vehiculo_id = p_vehiculo_id and supervisor_id = p_supervisor_id and hasta is null) then
    return;
  end if;
  update public.gps_vehiculo_supervisor_asignaciones set hasta = v_ahora
   where vehiculo_id = p_vehiculo_id and hasta is null;
  if p_supervisor_id is not null then
    insert into public.gps_vehiculo_supervisor_asignaciones (vehiculo_id, supervisor_id, desde, motivo, creado_por)
    values (p_vehiculo_id, p_supervisor_id, v_ahora, p_motivo, public.gps_usuario_actual_id());
  end if;
  insert into public.gps_vehiculos_accesos (usuario_id, accion, vehiculo_id, detalle)
  values (public.gps_usuario_actual_id(), 'gestionar', p_vehiculo_id, jsonb_build_object('op', 'asignar_supervisor', 'supervisor_id', p_supervisor_id));
end $fn$;

-- Registro de accesos al historial (lo llama la UI al abrir historial / prueba).
create or replace function public.gps_vehiculos_registrar_acceso(p_accion text, p_vehiculo_id uuid default null, p_detalle jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if not public.gps_vehiculos_puede_ver_actual() then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  insert into public.gps_vehiculos_accesos (usuario_id, accion, vehiculo_id, detalle)
  values (public.gps_usuario_actual_id(), p_accion, p_vehiculo_id, coalesce(p_detalle, '{}'::jsonb));
end $fn$;

revoke all on function public.gps_tag_guardar(uuid, text, text, text, text, boolean, text) from public, anon;
revoke all on function public.gps_vehiculo_guardar(uuid, text, text, text, text) from public, anon;
revoke all on function public.gps_vehiculo_asignar_tag(uuid, uuid, text) from public, anon;
revoke all on function public.gps_vehiculo_asignar_supervisor(uuid, uuid, text) from public, anon;
revoke all on function public.gps_vehiculos_registrar_acceso(text, uuid, jsonb) from public, anon;
grant execute on function public.gps_tag_guardar(uuid, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.gps_vehiculo_guardar(uuid, text, text, text, text) to authenticated;
grant execute on function public.gps_vehiculo_asignar_tag(uuid, uuid, text) to authenticated;
grant execute on function public.gps_vehiculo_asignar_supervisor(uuid, uuid, text) to authenticated;
grant execute on function public.gps_vehiculos_registrar_acceso(text, uuid, jsonb) to authenticated;

-- ── Ingesta (sólo servicio) ─────────────────────────────────────────────────
-- p_posiciones: [{ "lat": n, "lng": n, "hora_ubicacion": iso, "precision_m": n|null }, ...]
-- Sólo guarda posiciones reales recibidas; descarta inválidas y duplicadas.
-- Resultado de la consulta lo decide la base según lo que efectivamente se guardó.
create or replace function public.gps_tag_registrar_consulta(
  p_tag_id uuid, p_hora_consulta timestamptz, p_resultado text, p_posiciones jsonb default '[]'::jsonb,
  p_intentos smallint default 1, p_duracion_ms integer default null,
  p_error_codigo text default null, p_error_detalle text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_tag public.gps_tags%rowtype;
  v_consulta_id bigint;
  v_recibidas integer := coalesce(jsonb_array_length(p_posiciones), 0);
  v_nuevas integer := 0;
  v_descartadas integer := 0;
  v_resultado text := p_resultado;
  r jsonb; v_lat double precision; v_lng double precision; v_hora timestamptz; v_prec double precision;
  v_vehiculo uuid; v_supervisor uuid; v_insertadas integer;
begin
  select * into v_tag from public.gps_tags where id = p_tag_id;
  if not found then raise exception 'Smart Tag inexistente' using errcode = 'P0002'; end if;
  if p_resultado not in ('error', 'omitida_limite', 'sin_datos', 'ok') then
    raise exception 'Resultado inválido: %', p_resultado using errcode = '22023';
  end if;

  insert into public.gps_tag_consultas (tag_id, proveedor, hora_consulta, duracion_ms, intentos, resultado,
    posiciones_recibidas, error_codigo, error_detalle)
  values (p_tag_id, v_tag.proveedor, p_hora_consulta, p_duracion_ms, greatest(1, coalesce(p_intentos, 1)),
    case when p_resultado = 'ok' then 'sin_novedad' else p_resultado end,
    v_recibidas, left(p_error_codigo, 80), left(p_error_detalle, 500))
  returning id into v_consulta_id;

  if p_resultado = 'ok' then
    for r in select * from jsonb_array_elements(coalesce(p_posiciones, '[]'::jsonb)) loop
      begin
        v_lat := (r->>'lat')::double precision;
        v_lng := (r->>'lng')::double precision;
        v_hora := (r->>'hora_ubicacion')::timestamptz;
        v_prec := nullif(r->>'precision_m', '')::double precision;
      exception when others then
        v_descartadas := v_descartadas + 1; continue;
      end;
      if v_lat is null or v_lng is null or v_hora is null
         or v_lat not between -90 and 90 or v_lng not between -180 and 180
         or (v_lat = 0 and v_lng = 0)
         or v_hora > p_hora_consulta + interval '5 minutes' then
        v_descartadas := v_descartadas + 1; continue;
      end if;
      select a.vehiculo_id into v_vehiculo from public.gps_vehiculo_tag_asignaciones a
       where a.tag_id = p_tag_id and a.desde <= v_hora and (a.hasta is null or a.hasta > v_hora)
       order by a.desde desc limit 1;
      v_supervisor := null;
      if v_vehiculo is not null then
        select s.supervisor_id into v_supervisor from public.gps_vehiculo_supervisor_asignaciones s
         where s.vehiculo_id = v_vehiculo and s.desde <= v_hora and (s.hasta is null or s.hasta > v_hora)
         order by s.desde desc limit 1;
      end if;
      insert into public.gps_tag_posiciones (tag_id, fuente, lat, lng, precision_m, hora_ubicacion, hora_consulta,
        consulta_id, vehiculo_id, supervisor_id)
      values (p_tag_id, v_tag.proveedor, v_lat, v_lng, v_prec, v_hora, p_hora_consulta, v_consulta_id, v_vehiculo, v_supervisor)
      on conflict (tag_id, hora_ubicacion, lat, lng) do nothing;
      get diagnostics v_insertadas = row_count;
      v_nuevas := v_nuevas + v_insertadas;
    end loop;
    v_resultado := case when v_recibidas = 0 then 'sin_datos' when v_nuevas > 0 then 'nueva_posicion' else 'sin_novedad' end;
    update public.gps_tag_consultas set resultado = v_resultado, posiciones_nuevas = v_nuevas where id = v_consulta_id;
  end if;

  return jsonb_build_object('consulta_id', v_consulta_id, 'resultado', v_resultado,
    'recibidas', v_recibidas, 'nuevas', v_nuevas, 'descartadas', v_descartadas);
end $fn$;
revoke all on function public.gps_tag_registrar_consulta(uuid, timestamptz, text, jsonb, smallint, integer, text, text) from public, anon, authenticated;
grant execute on function public.gps_tag_registrar_consulta(uuid, timestamptz, text, jsonb, smallint, integer, text, text) to service_role;

comment on table public.gps_tag_posiciones is
  'Posiciones de Smart Tag (red Find Hub u origen simulado). NO es GPS continuo: puntos discretos informados cuando un teléfono Android cercano detecta el tag. hora_ubicacion = detección real; hora_consulta = cuándo MERCOSUR consultó.';
