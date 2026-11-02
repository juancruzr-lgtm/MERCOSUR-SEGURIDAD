-- ============================================================================
-- SÓLO LECTURA — Supervisiones mal reconocidas y evaluaciones que podrían
-- estar afectadas (auditoría oct-2026). Ningún UPDATE / INSERT.
-- Resultados al 02/11/2026: rondas_historial_exigencias.md §7.3
-- ============================================================================

-- ── 1) Supervisiones registradas en otro objetivo de la MISMA sede ──────────
-- Pares de objetivos a menos de 300 m; supervisión en A un día sin turno en A
-- y con turno en B. En producción sólo aparece el grupo LAROMET ROSARIO
-- (18 + 9 = 27 en octubre).
with o as (
  select id, nombre, estado, coalesce(lat, latitud) as la, coalesce(lng, longitud) as lo
    from public.objetivos where not es_prueba and coalesce(lat, latitud) is not null
), pares as (
  select a.id as a_id, a.nombre as a_nombre, b.id as b_id, b.nombre as b_nombre,
         round((6371000 * 2 * asin(sqrt(power(sin(radians(b.la - a.la) / 2), 2)
           + cos(radians(a.la)) * cos(radians(b.la)) * power(sin(radians(b.lo - a.lo) / 2), 2))))::numeric) as metros
    from o a join o b on a.id <> b.id
)
select p.a_nombre as registrada_en, p.b_nombre as sede_con_turno, p.metros,
       s.id as supervision_id,
       to_char(s.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') as fecha,
       u.apellido || ', ' || u.nombre as supervisor
  from pares p
  join public.supervisiones s on s.objetivo_id = p.a_id
  left join public.usuarios u on u.id = s.supervisor_id
 where p.metros < 300
   and s.estado <> 'incompleta'
   and s.created_at >= ('2026-10-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
   and s.created_at <  ('2026-11-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
   and not exists (select 1 from public.turnos t where t.objetivo_id = p.a_id
                    and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')
                    and t.fecha between (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date - 1
                                    and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date)
   and exists (select 1 from public.turnos t where t.objetivo_id = p.b_id
                and coalesce(t.estado, '') not in ('anulado', 'reemplazado', 'cancelado')
                and t.fecha between (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date - 1
                                and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date)
 order by p.b_nombre, s.created_at;

-- ── 2) Supervisiones a más de 1 km de las coordenadas del objetivo ──────────
-- 48 de 699 en octubre. La mayoría son objetivos MÓVILES (obras de Laromet:
-- la coordenada del objetivo quedó vieja) o lecturas con precisión > 700 m.
-- No prueban que la visita no ocurrió: son para revisar la coordenada del
-- objetivo, no para descontar supervisiones.
select o.nombre, o.tipo_ubicacion, s.id as supervision_id,
       to_char(s.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') as fecha,
       u.apellido || ', ' || u.nombre as supervisor,
       round((6371000 * 2 * asin(sqrt(power(sin(radians(s.lat - coalesce(o.lat, o.latitud)) / 2), 2)
         + cos(radians(s.lat)) * cos(radians(coalesce(o.lat, o.latitud)))
         * power(sin(radians(s.lng - coalesce(o.lng, o.longitud)) / 2), 2))))::numeric) as metros,
       round(s.precision_gps) as precision_m,
       case when s.precision_gps > 500 then 'precisión GPS baja'
            when o.tipo_ubicacion = 'movil' then 'objetivo móvil: revisar coordenada'
            else 'revisar' end as lectura
  from public.supervisiones s
  join public.objetivos o on o.id = s.objetivo_id
  left join public.usuarios u on u.id = s.supervisor_id
 where s.estado <> 'incompleta'
   and s.created_at >= ('2026-10-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
   and s.created_at <  ('2026-11-01'::timestamp at time zone 'America/Argentina/Buenos_Aires')
   and (6371000 * 2 * asin(sqrt(power(sin(radians(s.lat - coalesce(o.lat, o.latitud)) / 2), 2)
         + cos(radians(s.lat)) * cos(radians(coalesce(o.lat, o.latitud)))
         * power(sin(radians(s.lng - coalesce(o.lng, o.longitud)) / 2), 2)))) > 1000
 order by metros desc;

-- ── 3) Evaluaciones que podrían estar afectadas ─────────────────────────────
-- 3a) Supervisores: vencimientos de E1 en la sede LAROMET ROSARIO 2 (octubre).
select u.apellido || ', ' || u.nombre as supervisor, count(*) as vencimientos, sum(v.horas_vencido) as horas
  from public.evaluacion_vencimientos_supervision('2026-10-01', '2026-10-31') v
  left join public.usuarios u on u.id = v.supervisor_id
 where v.objetivo_id = 'e6586ac9-36fd-4ecf-a6c2-2997a72543dc'
 group by 1 order by 1;

-- 3b) Vigiladores: turnos cuyo historial de rondas cambió por editar la ronda
-- (alertas con una duración de ventana distinta del intervalo actual). Sus
-- obligaciones recalculadas no coinciden con las que se exigieron.
select o.nombre as objetivo, rb.nombre as ronda, rb.intervalo_minutos as intervalo_hoy,
       round(extract(epoch from (a.ventana_fin - a.ventana_inicio)) / 60) as intervalo_de_la_alerta,
       u.apellido || ', ' || u.nombre as vigilador,
       count(*) as alertas, min(a.ventana_inicio)::date as desde, max(a.ventana_inicio)::date as hasta,
       (select e.estado || ' · nota ' || e.nota_final from public.evaluaciones_mensuales e
         where e.empleado_id = a.guardia_id
           and e.periodo = to_char(min(a.ventana_inicio) at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')
         order by e.version desc limit 1) as evaluacion_del_mes
  from public.ronda_alertas a
  join public.rondas_base rb on rb.id = a.ronda_base_id
  join public.objetivos o on o.id = a.objetivo_id
  join public.usuarios u on u.id = a.guardia_id
 where round(extract(epoch from (a.ventana_fin - a.ventana_inicio)) / 60) < rb.intervalo_minutos
   -- la última ventana del turno puede ser más corta (acotada al fin del turno)
   and a.ventana_fin < (select (t.fecha + t.hora_fin + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
                               at time zone 'America/Argentina/Buenos_Aires'
                          from public.turnos t where t.id = a.turno_id)
 group by o.nombre, rb.nombre, rb.intervalo_minutos, a.ventana_fin - a.ventana_inicio, u.apellido, u.nombre, a.guardia_id
 order by o.nombre, desde;
