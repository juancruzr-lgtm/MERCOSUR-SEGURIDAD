-- ============================================================================
-- INTEGRIDAD DE PUNTOS DE RONDA
-- ============================================================================
-- 1) Registra la fecha/hora real de captura de la posición (posicion_capturada_at).
-- 2) Rechaza en el SERVIDOR (no evitable desde el navegador) puntos activos cuya
--    posición esté a menos de 3 m de otro punto activo de la misma ronda —
--    coordenadas idénticas incluidas. Distancia por Haversine real
--    (rondas_distancia_metros).
-- No borra ni modifica puntos existentes. No toca ejecución, asistencia,
-- liquidables ni JWM.

begin;

-- ── Fecha/hora real de captura de la posición ────────────────────────────────
alter table public.ronda_puntos
  add column if not exists posicion_capturada_at timestamptz;

grant insert (posicion_capturada_at) on table public.ronda_puntos to authenticated;
grant update (posicion_capturada_at) on table public.ronda_puntos to authenticated;

-- ── Anti-duplicado por proximidad (< 3 m) ────────────────────────────────────
-- Umbral central: si más adelante se decide otro valor, se cambia acá.
create or replace function public.ronda_puntos_no_duplicado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_dist_min constant double precision := 3.0;
  v_otro     record;
begin
  -- Solo se controla un punto activo con coordenadas.
  if new.activo is not true or new.latitud is null or new.longitud is null then
    return new;
  end if;

  -- En edición, solo controlar si de verdad se movió el punto o se reactivó.
  -- Editar el nombre/foto de un punto (incluso uno duplicado histórico) no debe
  -- bloquearse; recién al reubicarlo se exige que no coincida con otro.
  if tg_op = 'UPDATE'
     and new.latitud  is not distinct from old.latitud
     and new.longitud is not distinct from old.longitud
     and new.activo   is not distinct from old.activo then
    return new;
  end if;

  select rp.id, rp.orden, rp.nombre,
         public.rondas_distancia_metros(new.latitud, new.longitud, rp.latitud, rp.longitud) as dist
  into v_otro
  from public.ronda_puntos rp
  where rp.ronda_base_id = new.ronda_base_id
    and rp.id     <> new.id
    and rp.activo
    and rp.latitud  is not null
    and rp.longitud is not null
    and public.rondas_distancia_metros(new.latitud, new.longitud, rp.latitud, rp.longitud) < v_dist_min
  order by dist asc
  limit 1;

  if found then
    raise exception
      'ronda_punto_duplicado: la ubicación coincide con otro punto de la ronda (punto #%, % m)',
      v_otro.orden, round(v_otro.dist::numeric, 1)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Solo cuando cambian coordenadas o el estado activo (mover / reactivar / alta).
drop trigger if exists trg_ronda_puntos_no_duplicado on public.ronda_puntos;
create trigger trg_ronda_puntos_no_duplicado
  before insert or update of latitud, longitud, activo on public.ronda_puntos
  for each row execute function public.ronda_puntos_no_duplicado();

-- ── agregar_ronda_punto: suma p_posicion_capturada_at ────────────────────────
-- Se reemplaza la firma de 12 parámetros por una de 13 (default null). El cuerpo
-- es idéntico salvo la nueva columna en el INSERT. El anti-duplicado lo aplica
-- el trigger, no la RPC, para cubrir también las ediciones directas.
drop function if exists public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text
);

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
  p_activo boolean,
  p_politica_foto text default null,
  p_posicion_capturada_at timestamptz default null
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
    latitud, longitud, precision_metros, radio_metros, origen_posicion, activo,
    politica_foto, posicion_capturada_at
  ) values (
    p_ronda_base_id, btrim(p_nombre), nullif(btrim(p_descripcion), ''), v_orden,
    coalesce(p_foto_requerida, true), p_gps_requerido, p_latitud, p_longitud,
    p_precision_metros, p_radio_metros, p_origen_posicion, p_activo,
    p_politica_foto, p_posicion_capturada_at
  )
  returning * into v_punto;

  return v_punto;
end;
$$;

revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text, timestamptz
) from public;
revoke all on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text, timestamptz
) from anon;
grant execute on function public.agregar_ronda_punto(
  uuid, text, text, boolean, boolean, double precision, double precision,
  double precision, integer, text, boolean, text, timestamptz
) to authenticated;

notify pgrst, 'reload schema';

commit;
