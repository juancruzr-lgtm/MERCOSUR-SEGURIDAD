-- Etapa 2 — Configuración de rondas.
-- Crea exclusivamente la configuracion de rondas base y sus puntos.
-- No crea ejecuciones, obligaciones, cron ni modifica la integracion JWM.

create table public.rondas_base (
  id                 uuid primary key default gen_random_uuid(),
  objetivo_id        uuid not null references public.objetivos(id) on delete restrict,
  nombre             text not null,
  descripcion        text,
  intervalo_minutos  integer not null,
  activo             boolean not null default true,
  version            integer not null default 1,
  creado_por         uuid references public.usuarios(id) on delete set null,
  actualizado_por    uuid references public.usuarios(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint rondas_base_nombre_no_vacio check (length(btrim(nombre)) > 0),
  constraint rondas_base_intervalo_valido check (intervalo_minutos between 15 and 10080),
  constraint rondas_base_version_valida check (version >= 1)
);

create unique index rondas_base_objetivo_nombre_activo_unique
  on public.rondas_base (objetivo_id, lower(btrim(nombre)))
  where activo;

create index idx_rondas_base_objetivo_activas
  on public.rondas_base (objetivo_id, activo);

create table public.ronda_puntos (
  id                 uuid primary key default gen_random_uuid(),
  ronda_base_id      uuid not null references public.rondas_base(id) on delete restrict,
  nombre             text not null,
  descripcion        text,
  orden              integer not null,
  foto_requerida     boolean not null default true,
  gps_requerido      boolean not null default true,
  latitud            double precision,
  longitud           double precision,
  precision_metros   double precision,
  radio_metros       integer,
  activo             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ronda_puntos_nombre_no_vacio check (length(btrim(nombre)) > 0),
  constraint ronda_puntos_orden_valido check (orden between 1 and 10000),
  constraint ronda_puntos_latitud_valida check (latitud is null or latitud between -90 and 90),
  constraint ronda_puntos_longitud_valida check (longitud is null or longitud between -180 and 180),
  constraint ronda_puntos_coordenadas_completas check ((latitud is null) = (longitud is null)),
  constraint ronda_puntos_precision_valida check (precision_metros is null or precision_metros >= 0),
  constraint ronda_puntos_radio_valido check (radio_metros is null or radio_metros > 0),
  constraint ronda_puntos_ronda_orden_unique
    unique (ronda_base_id, orden) deferrable initially immediate
);

create index idx_ronda_puntos_ronda_activos_orden
  on public.ronda_puntos (ronda_base_id, activo, orden);

-- El helper set_updated_at() ya existe en 20260716_novedades_laborales.sql.
create trigger trg_rondas_base_updated_at
  before update on public.rondas_base
  for each row execute function public.set_updated_at();

create trigger trg_ronda_puntos_updated_at
  before update on public.ronda_puntos
  for each row execute function public.set_updated_at();

-- Resuelve el usuario operativo exclusivamente desde auth.uid().
create or replace function public.rondas_usuario_actual_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select u.id
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1
$$;

revoke all on function public.rondas_usuario_actual_id() from public;
revoke all on function public.rondas_usuario_actual_id() from anon;
grant execute on function public.rondas_usuario_actual_id() to authenticated;

-- Admin puede administrar cualquier objetivo. Supervisor solamente objetivos
-- cuya zona este asignada en supervisor_zonas.
create or replace function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and (
        u.rol = 'admin'
        or (
          u.rol = 'supervisor'
          and exists (
            select 1
            from public.objetivos o
            join public.supervisor_zonas sz on sz.zona_id = o.zona_id
            where o.id = p_objetivo_id
              and sz.supervisor_id = u.id
          )
        )
      )
  )
$$;

revoke all on function public.puede_administrar_rondas_objetivo(uuid) from public;
revoke all on function public.puede_administrar_rondas_objetivo(uuid) from anon;
grant execute on function public.puede_administrar_rondas_objetivo(uuid) to authenticated;

-- Completa la autoria desde la sesion y hace monotona la version.
create or replace function public.set_rondas_base_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario_id uuid;
begin
  v_usuario_id := public.rondas_usuario_actual_id();

  if tg_op = 'INSERT' then
    new.creado_por := coalesce(v_usuario_id, new.creado_por);
    new.actualizado_por := coalesce(v_usuario_id, new.actualizado_por);
    new.version := 1;
  else
    new.creado_por := old.creado_por;
    new.actualizado_por := coalesce(v_usuario_id, old.actualizado_por);
    new.version := old.version + 1;
  end if;

  return new;
end;
$$;

revoke all on function public.set_rondas_base_auditoria() from public;

create trigger trg_rondas_base_auditoria
  before insert or update on public.rondas_base
  for each row execute function public.set_rondas_base_auditoria();

-- Un cambio de composicion de puntos incrementa la version de la ronda base.
create or replace function public.touch_ronda_base_desde_punto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.rondas_base
  set updated_at = now()
  where id = coalesce(new.ronda_base_id, old.ronda_base_id);
  return coalesce(new, old);
end;
$$;

revoke all on function public.touch_ronda_base_desde_punto() from public;

create trigger trg_touch_ronda_base_desde_punto
  after insert or update on public.ronda_puntos
  for each row execute function public.touch_ronda_base_desde_punto();

alter table public.rondas_base enable row level security;
alter table public.ronda_puntos enable row level security;

create policy "Admin supervisor lee rondas de su alcance"
on public.rondas_base
for select
to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id));

create policy "Admin supervisor crea rondas de su alcance"
on public.rondas_base
for insert
to authenticated
with check (public.puede_administrar_rondas_objetivo(objetivo_id));

create policy "Admin supervisor actualiza rondas de su alcance"
on public.rondas_base
for update
to authenticated
using (public.puede_administrar_rondas_objetivo(objetivo_id))
with check (public.puede_administrar_rondas_objetivo(objetivo_id));

create policy "Admin supervisor lee puntos de su alcance"
on public.ronda_puntos
for select
to authenticated
using (
  exists (
    select 1
    from public.rondas_base rb
    where rb.id = ronda_puntos.ronda_base_id
      and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  )
);

create policy "Admin supervisor crea puntos de su alcance"
on public.ronda_puntos
for insert
to authenticated
with check (
  exists (
    select 1
    from public.rondas_base rb
    where rb.id = ronda_puntos.ronda_base_id
      and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  )
);

create policy "Admin supervisor actualiza puntos de su alcance"
on public.ronda_puntos
for update
to authenticated
using (
  exists (
    select 1
    from public.rondas_base rb
    where rb.id = ronda_puntos.ronda_base_id
      and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  )
)
with check (
  exists (
    select 1
    from public.rondas_base rb
    where rb.id = ronda_puntos.ronda_base_id
      and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  )
);

revoke all on table public.rondas_base from anon;
revoke all on table public.ronda_puntos from anon;
revoke all on table public.rondas_base from authenticated;
revoke all on table public.ronda_puntos from authenticated;
grant select on table public.rondas_base to authenticated;
grant insert (objetivo_id, nombre, descripcion, intervalo_minutos, activo)
  on table public.rondas_base to authenticated;
grant update (nombre, descripcion, intervalo_minutos, activo)
  on table public.rondas_base to authenticated;

grant select on table public.ronda_puntos to authenticated;
grant insert (
  ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido,
  latitud, longitud, precision_metros, radio_metros, activo
) on table public.ronda_puntos to authenticated;
grant update (
  nombre, descripcion, foto_requerida, gps_requerido, latitud, longitud,
  precision_metros, radio_metros, activo
) on table public.ronda_puntos to authenticated;

-- Reordena la lista completa de puntos en una unica transaccion. La lista debe
-- contener exactamente todos los puntos de la ronda, activos e inactivos.
create or replace function public.reordenar_ronda_puntos(
  p_ronda_base_id uuid,
  p_punto_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_objetivo_id uuid;
  v_total integer;
  v_distintos integer;
  v_id uuid;
  v_orden integer := 1;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select objetivo_id
  into v_objetivo_id
  from public.rondas_base
  where id = p_ronda_base_id
  for update;

  if not found then
    raise exception 'Ronda base no encontrada';
  end if;

  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    raise exception 'No autorizado para administrar esta ronda';
  end if;

  if p_punto_ids is null then
    raise exception 'La lista de puntos es obligatoria';
  end if;

  select count(*)
  into v_total
  from public.ronda_puntos
  where ronda_base_id = p_ronda_base_id;

  select count(distinct id)
  into v_distintos
  from unnest(p_punto_ids) as ids(id);

  if cardinality(p_punto_ids) <> v_distintos then
    raise exception 'La lista contiene puntos duplicados';
  end if;

  if cardinality(p_punto_ids) <> v_total then
    raise exception 'La lista debe contener todos los puntos de la ronda';
  end if;

  if exists (
    select 1
    from unnest(p_punto_ids) as ids(id)
    left join public.ronda_puntos rp
      on rp.id = ids.id
     and rp.ronda_base_id = p_ronda_base_id
    where rp.id is null
  ) then
    raise exception 'La lista contiene puntos ajenos a la ronda';
  end if;

  set constraints ronda_puntos_ronda_orden_unique deferred;

  foreach v_id in array p_punto_ids loop
    update public.ronda_puntos
    set orden = v_orden
    where id = v_id
      and ronda_base_id = p_ronda_base_id;
    v_orden := v_orden + 1;
  end loop;
end;
$$;

revoke all on function public.reordenar_ronda_puntos(uuid, uuid[]) from public;
revoke all on function public.reordenar_ronda_puntos(uuid, uuid[]) from anon;
grant execute on function public.reordenar_ronda_puntos(uuid, uuid[]) to authenticated;
