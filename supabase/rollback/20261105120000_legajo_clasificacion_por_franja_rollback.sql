-- Rollback de 20261105120000_legajo_clasificacion_por_franja.sql. Correr por separado.
-- Quita la función v2 y devuelve legajo_supervisores_guardias a su versión de
-- 20261030120000 (sin la noche del día anterior). No hay datos que perder.
-- Ojo: la pantalla de este PR usa la v2; revertir el código antes o junto.

begin;

drop function if exists public.legajo_supervisores_supervisiones_v2(uuid, date, date);

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

commit;
