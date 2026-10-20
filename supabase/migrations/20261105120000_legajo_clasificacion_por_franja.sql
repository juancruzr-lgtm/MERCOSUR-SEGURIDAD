-- Legajo operativo: supervisiones clasificadas por franja (auditoría del 20/10).
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Auditoría de JC (20/10) sobre José Luis Martínez, 01–20/10: 64 de 128
-- supervisiones figuraban «Fuera de su turno», pero las 64 eran guardias que el
-- calendario asignaba a otro supervisor (intercambios día↔noche con Aranda,
-- coberturas de Aranda y de Fulla) que éste NO trabajó. El cálculo de fechas,
-- noches y zona horaria era correcto; el problema era tener una sola categoría
-- para todo lo que no coincidía con el calendario. Aranda: 118 de 227, mismo
-- patrón.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- 1. legajo_supervisores_supervisiones_v2: cada supervisión en UNA de 4
--    categorías, mirando el INSTANTE (franja), no el día:
--    · en_turno          — una guardia propia de servicio, de la que es
--                          titular, la cubría.
--    · cubrio_otro       — trabajó una guardia programada para otro
--                          supervisor. Con nivel de certeza (`cobertura`):
--        - confirmada_programacion: su propia guardia está cargada como
--          reemplazo/cobertura de otro (supervisor_original_id). Ej.: noche
--          13/10 de JL, excepción manual en lugar de Aranda.
--        - confirmada_evidencia: intercambio en espejo. No tenía guardia; el
--          programado en ese momento (de la zona del objetivo) hizo, dentro
--          de ±24 h, más supervisiones que esta persona en una guardia que el
--          calendario le daba a ESTA persona. Ej.: 05/10 día JL / Aranda hizo
--          14 en la noche de JL.
--        - probable: sólo hay la señal débil de que, dentro de la guardia del
--          programado, esta persona hizo más supervisiones que él. REQUIERE
--          REVISIÓN: no confirma nada. Ej.: noche 02/10, noche 30/09 (Fulla).
--    · sin_programacion  — nadie de la zona del objetivo estaba programado.
--    · fuera_turno       — no tenía guardia y el programado estaba activo.
--    Ninguna es una falta ni penaliza: son datos para leer junto al
--    calendario, que puede no tener cargados los intercambios. No se modifica
--    el calendario.
--    Se devuelve quién estaba programado (programado) para ver intercambios.
--    Reemplaza al campo hay_guardia_cerca (día o día anterior), que confundía
--    «sin programación» con «fuera de turno».
-- 2. legajo_supervisores_guardias: incluye la guardia nocturna que empezó el
--    día ANTERIOR al período si termina dentro de él (antes quedaba afuera y
--    faltaban horas de servicio de 00 a 07 del primer día). La pantalla recorta
--    sus minutos al período.
--
-- ── Qué NO cambia ────────────────────────────────────────────────────────────
-- Permisos (las mismas 7 personas, mismo puede_ver_legajo_supervisores_actual),
-- guardias, calendario, supervisiones y datos: no se escribe nada. La función
-- vieja legajo_supervisores_supervisiones queda igual (la usa la versión hoy
-- desplegada hasta mergear este PR); se puede retirar más adelante.
--
-- Rollback: supabase/rollback/20261105120000_legajo_clasificacion_por_franja_rollback.sql
-- Verificación: supabase/verificacion/legajo_clasificacion_por_franja_post_migracion.sql

begin;

-- ============================================================================
-- 1. GUARDIAS: también la noche que empezó el día anterior al período
-- ============================================================================
create or replace function public.legajo_supervisores_guardias(p_supervisor_id uuid, p_desde date, p_hasta date)
returns table (
  guardia_id         uuid,
  supervisor_id      uuid,
  supervisor         text,
  fecha              date,
  zona               text,
  tipo_evento        text,
  estado             text,
  cubre              boolean,
  inicio             timestamptz,
  fin                timestamptz,
  horas_programadas  numeric,
  gps_desde          timestamptz,
  gps_hasta          timestamptz,
  gps_puntos         integer,
  supervisiones      integer,
  objetivos_visitados integer
)
language plpgsql stable security definer
set search_path = public, pg_catalog as $$
declare
  v_t0 timestamptz := p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires';
begin
  if not public.puede_ver_legajo_supervisores_actual() then
    raise exception 'sin permiso para ver el legajo operativo de supervisores' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 92 then
    raise exception 'rango inválido (máximo 92 días)' using errcode = '22023';
  end if;

  return query
  with g as (
    select g.id, g.supervisor_id, g.fecha, g.zona, coalesce(g.tipo_evento, 'normal') as tev,
           coalesce(g.estado, 'activo') as est,
           ( coalesce(g.estado, 'activo') = 'activo'
             and coalesce(g.rol_operativo, 'supervisor') = 'supervisor'
             and coalesce(g.tipo_evento, 'normal') not in ('franco', 'ausencia') ) as cub,
           ((g.fecha + g.hora_inicio)::timestamp at time zone 'America/Argentina/Buenos_Aires') as ini,
           ((g.fecha + g.hora_fin + case when g.hora_fin <= g.hora_inicio then interval '1 day' else interval '0' end)::timestamp
              at time zone 'America/Argentina/Buenos_Aires') as fin
      from public.supervisores_guardia g
     where g.fecha between p_desde - 1 and p_hasta
       and (p_supervisor_id is null or g.supervisor_id = p_supervisor_id)
  )
  select g.id, g.supervisor_id,
         trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')),
         g.fecha, g.zona, g.tev, g.est, g.cub, g.ini, g.fin,
         round((extract(epoch from g.fin - g.ini) / 3600.0)::numeric, 1),
         gp.desde, gp.hasta, coalesce(gp.n, 0)::int,
         coalesce(sv.n, 0)::int, coalesce(sv.obj, 0)::int
    from g
    join public.usuarios u on u.id = g.supervisor_id
    left join lateral (
      select min(p.client_ts) as desde, max(p.client_ts) as hasta, count(*) as n
        from public.supervisor_route_points p
       where p.supervisor_id = g.supervisor_id
         and p.turno_supervisor_id = g.id::text
         and p.client_ts >= g.ini - interval '2 hours'
         and p.client_ts <  g.fin + interval '2 hours'
    ) gp on true
    left join lateral (
      select count(*) as n, count(distinct s.objetivo_id) as obj
        from public.supervisiones s
       where s.supervisor_id = g.supervisor_id
         and s.estado <> 'incompleta'
         and s.created_at >= g.ini and s.created_at < g.fin
    ) sv on true
   -- la del día anterior sólo si su guardia llega al período (las nocturnas)
   where g.fecha >= p_desde or g.fin > v_t0
   order by g.ini;
end;
$$;

-- ============================================================================
-- 2. SUPERVISIONES clasificadas por franja (4 categorías)
-- ============================================================================
create or replace function public.legajo_supervisores_supervisiones_v2(p_supervisor_id uuid, p_desde date, p_hasta date)
returns table (
  supervision_id      uuid,
  supervisor_id       uuid,
  supervisor          text,
  created_at          timestamptz,
  objetivo_id         uuid,
  objetivo            text,
  zona_id             uuid,
  zona                text,
  estado              text,
  observaciones       text,
  items_total         integer,
  items_observados    integer,
  novedades_items     text,
  fotos               integer,
  lat                 numeric,
  lng                 numeric,
  distancia_objetivo_m integer,
  radio_m             integer,
  guardia_id          uuid,
  situacion           text,
  cobertura           text,
  programado          text
)
language plpgsql stable security definer
set search_path = public, pg_catalog as $$
declare
  v_t0 timestamptz := p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires';
  v_t1 timestamptz := (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
begin
  if not public.puede_ver_legajo_supervisores_actual() then
    raise exception 'sin permiso para ver el legajo operativo de supervisores' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 92 then
    raise exception 'rango inválido (máximo 92 días)' using errcode = '22023';
  end if;

  return query
  with gs as (  -- guardias de servicio (activas, rol supervisor, no franco/ausencia) alrededor del período
    select g.id, g.supervisor_id, g.supervisor_original_id, lower(trim(g.zona)) as zona,
           ((g.fecha + g.hora_inicio)::timestamp at time zone 'America/Argentina/Buenos_Aires') as ini,
           ((g.fecha + g.hora_fin + case when g.hora_fin <= g.hora_inicio then interval '1 day' else interval '0' end)::timestamp
              at time zone 'America/Argentina/Buenos_Aires') as fin
      from public.supervisores_guardia g
     where g.fecha between p_desde - 2 and p_hasta + 1
       and coalesce(g.estado, 'activo') = 'activo'
       and coalesce(g.rol_operativo, 'supervisor') = 'supervisor'
       and coalesce(g.tipo_evento, 'normal') not in ('franco', 'ausencia')
  ),
  sp as (  -- todas las supervisiones válidas que pueden caer en esas guardias
    select s.supervisor_id, s.created_at
      from public.supervisiones s
     where s.estado <> 'incompleta'
       and s.created_at >= v_t0 - interval '2 days' and s.created_at < v_t1 + interval '2 days'
  ),
  base as (
    select s.*, o.nombre as obj_nombre, o.zona_id as obj_zona_id, z.nombre as zona_nombre,
           o.latitud as o_lat2, o.lat as o_lat, o.longitud as o_lng2, o.lng as o_lng, o.radio_metros as o_radio
      from public.supervisiones s
      left join public.objetivos o on o.id = s.objetivo_id
      left join public.zonas_operativas z on z.id = o.zona_id
     where s.created_at >= v_t0 and s.created_at < v_t1
       and s.estado <> 'incompleta'
       and (p_supervisor_id is null or s.supervisor_id = p_supervisor_id)
       and coalesce(o.es_prueba, false) = false
  )
  select b.id, b.supervisor_id,
         trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')),
         b.created_at, b.objetivo_id, b.obj_nombre, b.obj_zona_id, b.zona_nombre, b.estado, b.observaciones,
         coalesce(r.total, 0)::int, coalesce(r.obs, 0)::int, r.novedades,
         (select count(*) from public.supervision_fotos f where f.supervision_id = b.id)::int,
         b.lat, b.lng,
         case when b.lat is null or coalesce(b.o_lat2, b.o_lat) is null then null
              else round(6371000 * 2 * asin(sqrt(
                     power(sin(radians((coalesce(b.o_lat2, b.o_lat) - b.lat)::float8) / 2), 2)
                   + cos(radians(b.lat::float8)) * cos(radians(coalesce(b.o_lat2, b.o_lat)::float8))
                   * power(sin(radians((coalesce(b.o_lng2, b.o_lng) - b.lng)::float8) / 2), 2))))::int end,
         b.o_radio,
         propia.id,
         case when propia.id is not null and propia.original is null then 'en_turno'
              when propia.id is not null                            then 'cubrio_otro'
              when otros.confirmados is not null or otros.probables is not null then 'cubrio_otro'
              when otros.programados = 0                            then 'sin_programacion'
              else 'fuera_turno' end,
         case when propia.id is not null and propia.original is not null then 'confirmada_programacion'
              when propia.id is not null                                  then null
              when otros.confirmados is not null                          then 'confirmada_evidencia'
              when otros.probables is not null                            then 'probable' end,
         case when propia.id is not null then propia.original
              else coalesce(otros.confirmados, otros.probables, otros.nombres) end
    from base b
    join public.usuarios u on u.id = b.supervisor_id
    left join lateral (
      select count(*) as total,
             count(*) filter (where rr.resultado = 'observado') as obs,
             string_agg(nullif(trim(rr.observacion), ''), ' · ') filter (where rr.resultado = 'observado') as novedades
        from public.supervision_respuestas rr where rr.supervision_id = b.id
    ) r on true
    -- su propia guardia de servicio en ese instante (y si está cargada como
    -- reemplazo/cobertura de otro: supervisor_original_id distinto de él)
    left join lateral (
      select gs.id,
             case when gs.supervisor_original_id is not null and gs.supervisor_original_id <> b.supervisor_id
                  then (select trim(coalesce(uo.nombre, '') || ' ' || coalesce(uo.apellido, ''))
                          from public.usuarios uo where uo.id = gs.supervisor_original_id) end as original
        from gs
       where gs.supervisor_id = b.supervisor_id and b.created_at >= gs.ini and b.created_at < gs.fin
       order by gs.ini desc limit 1
    ) propia on true
    -- otros programados en ese instante en la zona del objetivo
    left join lateral (
      select count(*) as programados,
             string_agg(distinct x.nombre, ', ') as nombres,
             -- intercambio en espejo: el otro trabajó (más que esta persona) una
             -- guardia que el calendario le daba a ESTA persona, dentro de ±24 h
             string_agg(distinct x.nombre, ', ') filter (where x.hizo_mas and x.espejo) as confirmados,
             -- sólo la señal débil: en la guardia del otro, esta persona hizo más
             string_agg(distinct x.nombre, ', ') filter (where x.hizo_mas and not x.espejo) as probables
        from (
          select trim(coalesce(uo.nombre, '') || ' ' || coalesce(uo.apellido, '')) as nombre,
                 (select count(*) from sp where sp.supervisor_id = gs.supervisor_id and sp.created_at >= gs.ini and sp.created_at < gs.fin)
                   < (select count(*) from sp where sp.supervisor_id = b.supervisor_id and sp.created_at >= gs.ini and sp.created_at < gs.fin) as hizo_mas,
                 exists (
                   select 1 from gs gp
                    where gp.supervisor_id = b.supervisor_id
                      and gp.ini < b.created_at + interval '24 hours' and gp.fin > b.created_at - interval '24 hours'
                      and (select count(*) from sp where sp.supervisor_id = gs.supervisor_id and sp.created_at >= gp.ini and sp.created_at < gp.fin)
                        > (select count(*) from sp where sp.supervisor_id = b.supervisor_id and sp.created_at >= gp.ini and sp.created_at < gp.fin)
                 ) as espejo
            from gs
            join public.usuarios uo on uo.id = gs.supervisor_id
           where gs.supervisor_id <> b.supervisor_id
             and gs.zona = lower(trim(b.zona_nombre))
             and b.created_at >= gs.ini and b.created_at < gs.fin
        ) x
    ) otros on true
   order by b.created_at;
end;
$$;

revoke all on function public.legajo_supervisores_supervisiones_v2(uuid, date, date) from public, anon;
grant execute on function public.legajo_supervisores_supervisiones_v2(uuid, date, date) to authenticated;

commit;
