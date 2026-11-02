-- Simulación (SÓLO LECTURA) de la histéresis del GPS del supervisor sobre los
-- puntos reales de octubre 2026 (supervisor_route_points).
--
-- Reproduce en SQL la máquina de lib/supervisor-gps-maquina.ts:
--   entrada: 1 lectura ≤ radio (sin demora: no se pierde ninguna visita)
--   cambio entre vecinos: como antes, gana el más cercano si la lectura está en su radio
--   salida : 2 lecturas seguidas > radio+25 m, o 1 > radio+100 m
--   MOVING ⇄ STOPPED: 2 lecturas seguidas; intervalos 60 s / 100 m
--   gps_recovered conserva el objetivo; session_start reinicia.
--
-- Entrada: cada punto guardado (salvo supervision/session_end) es una
-- "lectura". Es una COTA: las lecturas que el código viejo NO guardó (p. ej.
-- parado sin cambios) no están en la base, así que la simulación ve menos
-- lecturas de las que hubo. Con menos lecturas, la histéresis tiene menos
-- oportunidades de confirmar: el ahorro real puede diferir algunos puntos.
with recursive
obj as (
  select id::text as id, lat::float8 as lat, lng::float8 as lng, radio_metros::float8 as r
  from public.objetivos where lat is not null and lng is not null and coalesce(radio_metros, 0) > 0
),
pts as (
  select * from public.supervisor_route_points
  where client_ts >= '2026-10-01 03:00+00' and client_ts < '2026-11-01 03:00+00'
),
lect0 as (
  select coalesce(turno_supervisor_id, session_id::text) as turno, client_ts,
         latitud::float8 as lat, longitud::float8 as lng,
         max(velocidad_m_s)::float8 as speed,
         bool_or(tipo_punto = 'session_start') as es_start,
         bool_or(tipo_punto = 'gps_recovered') as es_rec,
         min(seq) as seq
  from pts where tipo_punto not in ('supervision', 'session_end')
  group by 1, 2, 3, 4
),
lect as (
  select l.*, extract(epoch from l.client_ts)::float8 as t,
         row_number() over (partition by l.turno order by l.client_ts, l.seq) as rn,
         n.id as near_id, n.d as near_d, n.r as near_r
  from lect0 l
  left join lateral (
    select o.id, o.r, 2*6371000*asin(sqrt(power(sin(radians(o.lat - l.lat)/2),2) + cos(radians(l.lat))*cos(radians(o.lat))*power(sin(radians(o.lng - l.lng)/2),2))) as d
    from obj o
    where 2*6371000*asin(sqrt(power(sin(radians(o.lat - l.lat)/2),2) + cos(radians(l.lat))*cos(radians(o.lat))*power(sin(radians(o.lng - l.lng)/2),2))) <= o.r
    order by 3 limit 1
  ) n on true
),
sim as (
  -- Estado: est, obj_id/lat/lng/r, cand_mov, cmn, cand_obj, con, csal, ultimo (ulat,ulng,ut), ins, enters, exits
  select l.turno, l.rn,
         'UNKNOWN'::text as est, null::text as obj_id, null::float8 as olat, null::float8 as olng, null::float8 as orr,
         null::text as cmov, 0 as cmn, null::text as cobj, 0 as con, 0 as csal,
         l.lat as ulat, l.lng as ulng, l.t as ut,
         1 as ins, 0 as enters, 0 as exits  -- session_start o primer punto del estado UNKNOWN
  from lect l where l.rn = 1
  union all
  select n.turno, n.rn, z.est, z.obj_id, z.olat, z.olng, z.orr, z.cmov, z.cmn, z.cobj, z.con, z.csal,
         z.ulat, z.ulng, z.ut, z.ins, z.enters, z.exits
  from sim s
  join lect n on n.turno = s.turno and n.rn = s.rn + 1
  -- L0: session_start reinicia; gps_recovered conserva objetivo.
  cross join lateral (
    select
      case when n.es_start then 'UNKNOWN' when n.es_rec and s.obj_id is null then 'UNKNOWN' else s.est end as est,
      case when n.es_start then null else s.obj_id end as obj_id,
      s.olat, s.olng, s.orr,
      case when n.es_start or (n.es_rec and s.obj_id is null) then null else s.cmov end as cmov,
      case when n.es_start or (n.es_rec and s.obj_id is null) then 0 else s.cmn end as cmn,
      case when n.es_start or n.es_rec then null else s.cobj end as cobj,
      case when n.es_start or n.es_rec then 0 else s.con end as con,
      case when n.es_start or n.es_rec then 0 else s.csal end as csal,
      case when n.es_start or n.es_rec then n.lat else s.ulat end as ulat,
      case when n.es_start or n.es_rec then n.lng else s.ulng end as ulng,
      case when n.es_start or n.es_rec then n.t else s.ut end as ut,
      (case when n.es_start or n.es_rec then 1 else 0 end) as ins0
  ) a
  -- L1: relación con el objetivo actual
  cross join lateral (
    select
      case when a.obj_id is null then null else
        2*6371000*asin(sqrt(power(sin(radians(a.olat - n.lat)/2),2) + cos(radians(n.lat))*cos(radians(a.olat))*power(sin(radians(a.olng - n.lng)/2),2))) end as dact,
      (n.near_id is not null and (case when n.near_r > 50 then n.near_d <= n.near_r - 25 else n.near_d <= n.near_r/2 end)) as near_bien
  ) b
  cross join lateral (
    select
      (a.obj_id is not null and n.near_id is not null and n.near_id <> a.obj_id and (b.dact > a.orr or n.near_d < b.dact)) as otro,
      (a.obj_id is not null and b.dact > a.orr + 25) as fuera
  ) c
  cross join lateral (
    select
      (a.obj_id is not null and not c.fuera and not c.otro) as adentro,
      case when a.obj_id is not null and (c.fuera or c.otro) then a.csal + 1 else 0 end as sal_n
  ) d
  cross join lateral (
    select
      (a.obj_id is not null and not d.adentro and not c.otro and d.sal_n < 2 and b.dact <= a.orr + 100) as pendiente,
      (a.obj_id is not null and not d.adentro and not (not c.otro and d.sal_n < 2 and b.dact <= a.orr + 100)) as sale
  ) e
  -- Base para la rama "afuera" (incluye recién salido sin cambio directo)
  cross join lateral (
    select
      case when e.sale then 'UNKNOWN' else a.est end as est,
      case when e.sale then null else a.cmov end as cmov,
      case when e.sale then 0 else a.cmn end as cmn,
      case when e.sale then n.lat else a.ulat end as ulat,
      case when e.sale then n.lng else a.ulng end as ulng,
      case when e.sale then n.t else a.ut end as ut
  ) f
  cross join lateral (
    select
      (n.near_id is not null) as entra,
      case when f.ut is null then 0
           else coalesce(n.speed, case when n.t - f.ut > 0 then
             2*6371000*asin(sqrt(power(sin(radians(f.ulat - n.lat)/2),2) + cos(radians(n.lat))*cos(radians(f.ulat))*power(sin(radians(f.ulng - n.lng)/2),2))) / (n.t - f.ut) else 0 end) end as vel,
      (f.ut is null or n.t - f.ut >= 60 or
        2*6371000*asin(sqrt(power(sin(radians(f.ulat - n.lat)/2),2) + cos(radians(n.lat))*cos(radians(f.ulat))*power(sin(radians(f.ulng - n.lng)/2),2))) >= 100) as intervalo
  ) g
  cross join lateral (
    select case when g.vel >= 0.5 then 'MOVING' else 'STOPPED' end as crudo
  ) h
  cross join lateral (
    select case when f.cmov = h.crudo then f.cmn + 1 else 1 end as cmn_nuevo
  ) i
  cross join lateral (
    select
      -- ── Resultado según rama ──
      case
        when n.es_start then 'UNKNOWN'
        when d.adentro or e.pendiente then a.est
        when e.sale and c.otro then 'IN_OBJETIVO'
        when g.entra then 'IN_OBJETIVO'
        when f.est in ('UNKNOWN', 'IN_OBJETIVO') then h.crudo
        when h.crudo = f.est then f.est
        when i.cmn_nuevo >= 2 then h.crudo
        else f.est end as est,
      case
        when n.es_start then null
        when d.adentro or e.pendiente then a.obj_id
        when (e.sale and c.otro) or g.entra then n.near_id
        else null end as obj_id,
      case when n.es_start then 0
        when d.adentro then (case when (a.ut is null or n.t - a.ut >= 60 or
          2*6371000*asin(sqrt(power(sin(radians(a.ulat - n.lat)/2),2) + cos(radians(n.lat))*cos(radians(a.ulat))*power(sin(radians(a.ulng - n.lng)/2),2))) >= 100) then 1 else 0 end)
        when e.pendiente then 0
        when e.sale and c.otro then 2
        else (case when e.sale then 1 else 0 end) + (case
          when g.entra then 1
          when f.est in ('UNKNOWN', 'IN_OBJETIVO') then 1
          when h.crudo = f.est then (case when f.est = 'MOVING' and g.intervalo then 1 else 0 end)
          when i.cmn_nuevo >= 2 then 1
          else (case when f.est = 'MOVING' and g.intervalo then 1 else 0 end) end)
      end as ins_m,
      (case when n.es_start then 0 when (e.sale and c.otro) or (not d.adentro and not e.pendiente and g.entra) then 1 else 0 end) as ent,
      (case when n.es_start then 0 when e.sale then 1 else 0 end) as sal
  ) j
  cross join lateral (
    select
      j.est, j.obj_id,
      case when j.obj_id is null then null when j.obj_id = a.obj_id then a.olat else (select o.lat from obj o where o.id = j.obj_id) end as olat,
      case when j.obj_id is null then null when j.obj_id = a.obj_id then a.olng else (select o.lng from obj o where o.id = j.obj_id) end as olng,
      case when j.obj_id is null then null when j.obj_id = a.obj_id then a.orr else (select o.r from obj o where o.id = j.obj_id) end as orr,
      case when n.es_start or d.adentro or e.pendiente or g.entra or (e.sale and c.otro) then null
           when f.est in ('UNKNOWN', 'IN_OBJETIVO') or h.crudo = f.est or i.cmn_nuevo >= 2 then null
           else h.crudo end as cmov,
      case when n.es_start or d.adentro or e.pendiente or g.entra or (e.sale and c.otro) then 0
           when f.est in ('UNKNOWN', 'IN_OBJETIVO') or h.crudo = f.est or i.cmn_nuevo >= 2 then 0
           else i.cmn_nuevo end as cmn,
      case when n.es_start or d.adentro or e.pendiente or g.entra or (e.sale and c.otro) or n.near_id is null then null else n.near_id end as cobj,
      case when n.es_start or d.adentro or e.pendiente or g.entra or (e.sale and c.otro) or n.near_id is null then 0
           when a.cobj = n.near_id then a.con + 1 else 1 end as con,
      case when e.pendiente then d.sal_n else 0 end as csal,
      case when j.ins_m > 0 then n.lat else a.ulat end as ulat,
      case when j.ins_m > 0 then n.lng else a.ulng end as ulng,
      case when j.ins_m > 0 then n.t else a.ut end as ut,
      a.ins0 + j.ins_m as ins,
      j.ent as enters, j.sal as exits
  ) z
),
nuevo as (
  select s.turno, l.client_ts, s.ins, s.enters, s.exits from sim s join lect l on l.turno = s.turno and l.rn = s.rn
),
fijos as ( -- puntos que no dependen de la máquina: supervision y session_end
  select coalesce(turno_supervisor_id, session_id::text) as turno, client_ts, 1 as ins
  from pts where tipo_punto in ('supervision', 'session_end')
),
por_hora_nuevo as (
  select turno, date_trunc('hour', client_ts) h, sum(ins) n from (
    select turno, client_ts, ins from nuevo union all select turno, client_ts, ins from fijos) x group by 1, 2
),
vs as (select distinct turno, obj_id from sim where enters > 0 and obj_id is not null),
vr as (select distinct coalesce(turno_supervisor_id, session_id::text) turno, objetivo_cercano_id obj_id from pts where tipo_punto = 'objetivo_enter' and objetivo_cercano_id is not null),
sup as (select distinct coalesce(turno_supervisor_id, session_id::text) turno, objetivo_cercano_id obj_id from pts where tipo_punto = 'supervision' and objetivo_cercano_id is not null),
por_hora_viejo as (
  select coalesce(turno_supervisor_id, session_id::text) turno, date_trunc('hour', client_ts) h, count(*) n from pts group by 1, 2
)
select
  (select count(*) from pts) as puntos_reales,
  (select sum(ins) from nuevo) + (select count(*) from fijos) as puntos_simulados,
  (select count(*) from pts where tipo_punto = 'objetivo_enter') as enter_reales,
  (select sum(enters) from nuevo) as enter_simulados,
  (select count(*) from pts where tipo_punto = 'objetivo_exit') as exit_reales,
  (select sum(exits) from nuevo) as exit_simulados,
  (select count(*) from pts where tipo_punto in ('moving', 'stopped')) as mov_stop_reales,
  (select max(n) from por_hora_viejo) as pico_hora_real,
  (select max(n) from por_hora_nuevo) as pico_hora_simulado,
  (select count(*) from por_hora_viejo where n >= 70) as horas_70_mas_real,
  (select count(*) from por_hora_nuevo where n >= 70) as horas_70_mas_simulado,
  (select percentile_cont(0.95) within group (order by n) from por_hora_viejo) as p95_hora_real,
  (select percentile_cont(0.95) within group (order by n) from por_hora_nuevo) as p95_hora_simulado,
  -- Cobertura: ninguna visita (turno, objetivo) ni supervisión debe quedar sin entrada.
  (select count(*) from vr) as visitas_reales,
  (select count(*) from vr where not exists (select 1 from vs where vs.turno = vr.turno and vs.obj_id = vr.obj_id)) as visitas_reales_sin_entrada_simulada,
  (select count(*) from sup) as supervisiones_turno_objetivo,
  (select count(*) from sup where exists (select 1 from vr where vr.turno = sup.turno and vr.obj_id = sup.obj_id)) as sup_con_entrada_real,
  (select count(*) from sup where exists (select 1 from vs where vs.turno = sup.turno and vs.obj_id = sup.obj_id)) as sup_con_entrada_simulada;
