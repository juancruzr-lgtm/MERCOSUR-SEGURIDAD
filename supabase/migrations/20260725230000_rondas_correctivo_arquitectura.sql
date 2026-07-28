-- Parche correctivo aditivo para la Etapa 2 — Configuración de rondas.
-- No crea ejecuciones, obligaciones ni modifica JWM.

begin;

create unique index if not exists puestos_id_objetivo_unique
  on public.puestos (id, objetivo_id);

alter table public.rondas_base
  add column puesto_id uuid null,
  add column hora_inicio time null;

-- Solo asigna cuando el objetivo tiene exactamente un puesto real.
with puesto_unico as (
  select objetivo_id, (array_agg(id order by id))[1] as puesto_id
  from public.puestos
  group by objetivo_id
  having count(*) = 1
)
update public.rondas_base rb
set puesto_id = pu.puesto_id
from puesto_unico pu
where pu.objetivo_id = rb.objetivo_id
  and rb.puesto_id is null;

do $$
declare
  v_ambiguas text;
begin
  select string_agg(
    format('%s (%s): %s puesto(s)', rb.nombre, rb.id, coalesce(pc.cantidad, 0)),
    '; ' order by rb.nombre
  )
  into v_ambiguas
  from public.rondas_base rb
  left join (
    select objetivo_id, count(*) as cantidad
    from public.puestos
    group by objetivo_id
  ) pc on pc.objetivo_id = rb.objetivo_id
  where rb.puesto_id is null;

  if v_ambiguas is not null then
    raise exception
      'Rondas sin puesto inequívoco: %. Resolver manualmente antes de imponer NOT NULL.',
      v_ambiguas;
  end if;
end;
$$;

alter table public.rondas_base
  alter column puesto_id set not null,
  add constraint rondas_base_puesto_objetivo_fkey
    foreign key (puesto_id, objetivo_id)
    references public.puestos (id, objetivo_id)
    on delete restrict;

create index idx_rondas_base_puesto_activas
  on public.rondas_base (puesto_id, activo);

drop index if exists public.rondas_base_objetivo_nombre_activo_unique;
create unique index rondas_base_puesto_nombre_activo_unique
  on public.rondas_base (puesto_id, lower(btrim(nombre)))
  where activo;

grant insert (puesto_id, hora_inicio)
  on table public.rondas_base to authenticated;
grant update (hora_inicio)
  on table public.rondas_base to authenticated;

-- Informa permiso efectivo y motivo sin conceder escritura ni eludir RLS.
create or replace function public.estado_acceso_rondas_objetivo(p_objetivo_id uuid)
returns table (
  puede_administrar boolean,
  motivo text,
  cantidad_rondas bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_rol text;
  v_zona_id uuid;
  v_usuario_id uuid;
begin
  select u.id, u.rol
  into v_usuario_id, v_rol
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  select o.zona_id
  into v_zona_id
  from public.objetivos o
  where o.id = p_objetivo_id;

  cantidad_rondas := (
    select count(*) from public.rondas_base rb
    where rb.objetivo_id = p_objetivo_id
  );

  if v_usuario_id is null then
    puede_administrar := false;
    motivo := 'sin_permiso';
  elsif v_rol = 'admin' then
    puede_administrar := true;
    motivo := 'administrador';
  elsif v_rol <> 'supervisor' then
    puede_administrar := false;
    motivo := 'sin_permiso';
  elsif v_zona_id is null then
    puede_administrar := false;
    motivo := 'objetivo_sin_zona';
  elsif exists (
    select 1 from public.supervisor_zonas sz
    where sz.supervisor_id = v_usuario_id
      and sz.zona_id = v_zona_id
  ) then
    puede_administrar := true;
    motivo := 'supervisor_en_zona';
  else
    puede_administrar := false;
    motivo := 'fuera_de_zona';
  end if;

  return next;
end;
$$;

revoke all on function public.estado_acceso_rondas_objetivo(uuid) from public;
revoke all on function public.estado_acceso_rondas_objetivo(uuid) from anon;
grant execute on function public.estado_acceso_rondas_objetivo(uuid) to authenticated;

-- Serializa el alta por ronda mediante el bloqueo de la fila estable de base.
create or replace function public.agregar_ronda_punto(
  p_ronda_base_id uuid,
  p_nombre text,
  p_descripcion text,
  p_foto_requerida boolean,
  p_gps_requerido boolean,
  p_latitud double precision,
  p_longitud double precision,
  p_precision_metros double precision,
  p_radio_metros integer,
  p_origen_posicion text,
  p_activo boolean
)
returns public.ronda_puntos
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_objetivo_id uuid;
  v_orden integer;
  v_punto public.ronda_puntos;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select rb.objetivo_id
  into v_objetivo_id
  from public.rondas_base rb
  where rb.id = p_ronda_base_id
  for update;

  if not found then
    raise exception 'Ronda base no encontrada';
  end if;
  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    raise exception 'No autorizado para administrar esta ronda';
  end if;

  perform 1
  from public.ronda_puntos rp
  where rp.ronda_base_id = p_ronda_base_id
  for update;

  select coalesce(max(rp.orden), 0) + 1
  into v_orden
  from public.ronda_puntos rp
  where rp.ronda_base_id = p_ronda_base_id;

  if v_orden > 10000 then
    raise exception 'La ronda alcanzo el maximo de puntos permitido';
  end if;

  insert into public.ronda_puntos (
    ronda_base_id, nombre, descripcion, orden, foto_requerida, gps_requerido,
    latitud, longitud, precision_metros, radio_metros, origen_posicion, activo
  ) values (
    p_ronda_base_id, btrim(p_nombre), nullif(btrim(p_descripcion), ''), v_orden,
    p_foto_requerida, p_gps_requerido, p_latitud, p_longitud,
    p_precision_metros, p_radio_metros, p_origen_posicion, p_activo
  )
  returning * into v_punto;

  return v_punto;
end;
$$;

revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
) from public;
revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
) from anon;
grant execute on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean
) to authenticated;

-- Evita incrementar la versión una vez por cada punto durante un reordenamiento.
create or replace function public.touch_ronda_base_desde_punto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_setting('app.reordenando_ronda', true) = '1' then
    return coalesce(new, old);
  end if;

  update public.rondas_base
  set updated_at = now()
  where id = coalesce(new.ronda_base_id, old.ronda_base_id);
  return coalesce(new, old);
end;
$$;

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

  select objetivo_id into v_objetivo_id
  from public.rondas_base
  where id = p_ronda_base_id
  for update;

  if not found then raise exception 'Ronda base no encontrada'; end if;
  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    raise exception 'No autorizado para administrar esta ronda';
  end if;
  if p_punto_ids is null then raise exception 'La lista de puntos es obligatoria'; end if;

  select count(*) into v_total
  from public.ronda_puntos where ronda_base_id = p_ronda_base_id;
  select count(distinct id) into v_distintos
  from unnest(p_punto_ids) as ids(id);

  if cardinality(p_punto_ids) <> v_distintos then
    raise exception 'La lista contiene puntos duplicados';
  end if;
  if cardinality(p_punto_ids) <> v_total then
    raise exception 'La ronda cambio mientras se reordenaba; recargue e intente nuevamente';
  end if;
  if exists (
    select 1
    from unnest(p_punto_ids) as ids(id)
    left join public.ronda_puntos rp
      on rp.id = ids.id and rp.ronda_base_id = p_ronda_base_id
    where rp.id is null
  ) then
    raise exception 'La lista contiene puntos ajenos a la ronda';
  end if;

  perform set_config('app.reordenando_ronda', '1', true);
  set constraints ronda_puntos_ronda_orden_unique deferred;

  foreach v_id in array p_punto_ids loop
    update public.ronda_puntos
    set orden = v_orden
    where id = v_id and ronda_base_id = p_ronda_base_id;
    v_orden := v_orden + 1;
  end loop;

  set constraints ronda_puntos_ronda_orden_unique immediate;
  perform set_config('app.reordenando_ronda', '0', true);

  update public.rondas_base
  set updated_at = now()
  where id = p_ronda_base_id;
end;
$$;

commit;
