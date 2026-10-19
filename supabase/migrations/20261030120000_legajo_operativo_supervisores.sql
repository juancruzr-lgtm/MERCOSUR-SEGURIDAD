-- Legajo operativo de supervisores — Etapa 2A: SÓLO LECTURA.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- Por supervisor y período, en un solo lugar:
--  · cada guardia PROGRAMADA (supervisores_guardia) y la ACTIVIDAD REGISTRADA
--    por la app durante esa guardia (primer y último punto GPS);
--  · cada supervisión, con la guardia del propio supervisor que la cubría (o
--    ninguna: fuera de turno), su checklist y lo que anotó (novedades);
--  · los puntos GPS de una guardia, para dibujar el recorrido.
-- Con esto se arma el legajo, el mapa y los gráficos por hora, y se puede
-- decir «no supervisó en esa franja» sólo cuando estaba de servicio.
--
-- ── Qué NO es ────────────────────────────────────────────────────────────────
-- El supervisor no ficha. «Actividad registrada» = puntos GPS que la app envía
-- sola mientras la guardia programada está vigente (lib/supervisor-gps.ts). Sin
-- puntos no hay evidencia, que no es lo mismo que «no trabajó» (app cerrada,
-- sin señal, otro teléfono). La pantalla lo dice así.
--
-- No crea tablas, no escribe datos, no agrega triggers ni crons. No cambia
-- las funciones de la Etapa 1 ni su permiso (ranking: Dirección y Gerencia).
--
-- ── Quién lo ve ──────────────────────────────────────────────────────────────
-- Dirección Operativa, Gerencia, delegación gerencial y el Jefe de
-- supervisores que NO tiene zona asignada (JC 19/10: Aldo Monzón evalúa a sus
-- supervisores; Sergio Martínez, jefe pero que supervisa Rosario y es
-- evaluado, no ve los legajos de sus pares). Sin nombres fijos: si mañana un
-- jefe toma una zona, deja de ver; si la suelta, vuelve a ver. La tabla
-- supervisor_route_points sigue con su RLS (cada uno lo suyo + admin): acá se
-- lee por funciones SECURITY DEFINER con este permiso, sin abrir la tabla.
--
-- Rollback: supabase/rollback/20261030120000_legajo_operativo_supervisores_rollback.sql

begin;

-- ============================================================================
-- 1. QUIÉN VE EL LEGAJO OPERATIVO
-- ============================================================================
create or replace function public.puede_ver_legajo_supervisores_actual()
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select public.puede_evaluar_supervisores_actual()
      or exists (
           select 1 from public.usuarios u
            where u.auth_user_id = auth.uid() and u.estado = 'activo'
              and u.puesto_organizacional = 'jefe_supervisores'
              -- Un jefe que también supervisa una zona es evaluado como uno
              -- más (P2): no ve los legajos de sus pares (JC 19/10).
              and not exists (select 1 from public.supervisor_zonas sz where sz.supervisor_id = u.id))
$$;

-- ============================================================================
-- 2. GUARDIAS: programado vs actividad registrada
--    cubre = la guardia cuenta como servicio (activa, rol supervisor, no franco
--    ni ausencia). Las que no cubren se devuelven igual para mostrarlas, pero
--    no suman horas ni exigen actividad.
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
     where g.fecha between p_desde and p_hasta
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
   order by g.ini;
end;
$$;

-- ============================================================================
-- 3. SUPERVISIONES con su turno, checklist y novedades anotadas
--    guardia_id = la guardia del PROPIO supervisor que cubría ese instante
--    (activa, rol supervisor, no franco/ausencia). null = fuera de turno.
--    hay_guardia_cerca = tenía alguna guardia cargada ese día o el anterior
--    (para separar «fuera de turno» de «calendario sin cargar»).
-- ============================================================================
create or replace function public.legajo_supervisores_supervisiones(p_supervisor_id uuid, p_desde date, p_hasta date)
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
  hay_guardia_cerca   boolean
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
  select s.id, s.supervisor_id,
         trim(coalesce(u.nombre, '') || ' ' || coalesce(u.apellido, '')),
         s.created_at, s.objetivo_id, o.nombre, o.zona_id, z.nombre, s.estado, s.observaciones,
         coalesce(r.total, 0)::int, coalesce(r.obs, 0)::int, r.novedades,
         (select count(*) from public.supervision_fotos f where f.supervision_id = s.id)::int,
         s.lat, s.lng,
         case when s.lat is null or coalesce(o.latitud, o.lat) is null then null
              else round(6371000 * 2 * asin(sqrt(
                     power(sin(radians((coalesce(o.latitud, o.lat) - s.lat)::float8) / 2), 2)
                   + cos(radians(s.lat::float8)) * cos(radians(coalesce(o.latitud, o.lat)::float8))
                   * power(sin(radians((coalesce(o.longitud, o.lng) - s.lng)::float8) / 2), 2))))::int end,
         o.radio_metros,
         ( select g.id from public.supervisores_guardia g
            where g.supervisor_id = s.supervisor_id
              and coalesce(g.estado, 'activo') = 'activo'
              and coalesce(g.rol_operativo, 'supervisor') = 'supervisor'
              and coalesce(g.tipo_evento, 'normal') not in ('franco', 'ausencia')
              and g.fecha in (loc.d, loc.d - 1)
              and loc.t >= g.fecha + g.hora_inicio
              and loc.t <  g.fecha + g.hora_fin
                           + case when g.hora_fin <= g.hora_inicio then interval '1 day' else interval '0' end
            order by g.fecha desc limit 1 ),
         exists ( select 1 from public.supervisores_guardia g
                   where g.supervisor_id = s.supervisor_id and g.fecha in (loc.d, loc.d - 1) )
    from public.supervisiones s
    cross join lateral (select (s.created_at at time zone 'America/Argentina/Buenos_Aires') as t,
                               (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date as d) loc
    join public.usuarios u on u.id = s.supervisor_id
    left join public.objetivos o on o.id = s.objetivo_id
    left join public.zonas_operativas z on z.id = o.zona_id
    left join lateral (
      select count(*) as total,
             count(*) filter (where rr.resultado = 'observado') as obs,
             string_agg(nullif(trim(rr.observacion), ''), ' · ') filter (where rr.resultado = 'observado') as novedades
        from public.supervision_respuestas rr where rr.supervision_id = s.id
    ) r on true
   where s.created_at >= v_t0 and s.created_at < v_t1
     and s.estado <> 'incompleta'
     and (p_supervisor_id is null or s.supervisor_id = p_supervisor_id)
     and coalesce(o.es_prueba, false) = false
   order by s.created_at;
end;
$$;

-- ============================================================================
-- 4. RECORRIDO DE UNA GUARDIA: los puntos GPS tal como se registraron
--    (el cliente decide qué tramos se pueden unir: ver lib/legajo-supervisor.ts)
-- ============================================================================
create or replace function public.legajo_supervisor_recorrido(p_guardia_id uuid)
returns table (
  ts                         timestamptz,
  lat                        numeric,
  lng                        numeric,
  precision_m                integer,
  tipo_punto                 text,
  estado_movimiento          text,
  segundos_desde_anterior    integer,
  distancia_desde_anterior_m integer,
  objetivo_cercano_id        text,
  supervision_id             text
)
language plpgsql stable security definer
set search_path = public, pg_catalog as $$
begin
  if not public.puede_ver_legajo_supervisores_actual() then
    raise exception 'sin permiso para ver el legajo operativo de supervisores' using errcode = '42501';
  end if;

  return query
  select p.client_ts, p.latitud, p.longitud, p.precision_m, p.tipo_punto, p.estado_movimiento,
         p.segundos_desde_anterior, p.distancia_desde_anterior_m, p.objetivo_cercano_id, p.supervision_id
    from public.supervisores_guardia g
    join public.supervisor_route_points p
      on p.supervisor_id = g.supervisor_id
     and p.turno_supervisor_id = g.id::text
   where g.id = p_guardia_id
   order by p.client_ts, p.seq
   limit 5000;
end;
$$;

-- ============================================================================
-- 5. PERMISOS
-- ============================================================================
revoke all on function public.puede_ver_legajo_supervisores_actual()                        from public, anon;
revoke all on function public.legajo_supervisores_guardias(uuid, date, date)                 from public, anon;
revoke all on function public.legajo_supervisores_supervisiones(uuid, date, date)            from public, anon;
revoke all on function public.legajo_supervisor_recorrido(uuid)                             from public, anon;
grant execute on function public.puede_ver_legajo_supervisores_actual()                     to authenticated;
grant execute on function public.legajo_supervisores_guardias(uuid, date, date)             to authenticated;
grant execute on function public.legajo_supervisores_supervisiones(uuid, date, date)        to authenticated;
grant execute on function public.legajo_supervisor_recorrido(uuid)                          to authenticated;

commit;
