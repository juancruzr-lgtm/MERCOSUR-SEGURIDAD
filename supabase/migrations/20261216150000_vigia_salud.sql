-- ============================================================================
-- Vigía externo: funciones de salud (incidente Disk IO 18/11/2026)
-- ============================================================================
-- La caída del 18/11 la detectó un vigilador porque todos los avisos de la app
-- salen de pg_cron y mueren con la base. El vigía nuevo corre AFUERA (GitHub
-- Actions) y usa estas dos funciones, que SOLO LEEN:
--
--   1. salud_ping()      → anon/authenticated. Devuelve la hora del servidor.
--                          Mide de punta a punta "¿responde la base por la API?".
--                          No expone ningún dato.
--   2. monitor_salud()   → SOLO service_role (la llama /api/salud en Vercel).
--                          Conexiones, consultas trabadas, cache hit, crons,
--                          turnos sin fichaje y telemetría de ingresos.
--                          Cifras agregadas, sin nombres ni datos personales.
--
-- statement_timeout propio de 3 s: si la base está saturada, la función falla
-- rápido (y eso mismo es la alarma) en vez de sumar carga.
-- No crea tablas, no escribe nada, no cambia permisos de otras cosas.
--
-- Rollback: supabase/rollback/20261216150000_vigia_salud_rollback.sql
-- ============================================================================

begin;

create or replace function public.salud_ping()
returns timestamptz
language sql
stable
set statement_timeout = '2s'
as $fn$ select now() $fn$;

comment on function public.salud_ping() is
  'Vigía externo: ping de la base por la API. Sin datos. Incidente 18/11/2026.';

revoke all on function public.salud_ping() from public;
grant execute on function public.salud_ping() to anon, authenticated, service_role;


create or replace function public.monitor_salud()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
set statement_timeout = '3s'
as $fn$
declare
  v_ahora_ar timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  r jsonb := '{}'::jsonb;
  v_cron jsonb;
  v_turnos int; v_sin_fichaje int;
  v_ing_ini int; v_ing_ok int;
begin
  -- Conexiones y consultas trabadas (sólo backends de clientes).
  r := r || jsonb_build_object('conexiones', (
    select jsonb_build_object(
      'total',      count(*),
      'activas',    count(*) filter (where a.state = 'active'),
      'en_espera_lock', count(*) filter (where a.wait_event_type = 'Lock'),
      'trabadas_30s', count(*) filter (where a.state = 'active'
                                         and a.query_start < now() - interval '30 seconds'
                                         and a.pid <> pg_backend_pid()),
      'max',        current_setting('max_connections')::int)
    from pg_stat_activity a
    where a.backend_type = 'client backend'));

  -- Lecturas desde memoria (acumulado desde el último reinicio).
  r := r || jsonb_build_object('cache', (
    select jsonb_build_object(
      'hit_pct', round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2),
      'bloques_disco', sum(blks_read),
      'tam_base_mb', round(pg_database_size(current_database()) / 1048576.0))
    from pg_stat_database where datname = current_database()));

  -- Crons: fallas de los últimos 30 min y última ejecución por tarea activa.
  -- job_run_details tiene ~100k filas y sólo índice por runid: se leen las
  -- últimas 400 ejecuciones por ese índice (~7 h) en vez de recorrer todo.
  -- Una tarea diaria puede no aparecer en esa ventana: ultima_min = null.
  with rec as materialized (
    select d.jobid, d.status, d.start_time
      from cron.job_run_details d
     order by d.runid desc
     limit 400
  )
  select jsonb_build_object(
    'fallas_30m', (select count(*) from rec
                    where rec.start_time > now() - interval '30 minutes'
                      and rec.status = 'failed'),
    'corriendo_mas_10m', (select count(*) from rec
                    where rec.status in ('running','starting')
                      and rec.start_time < now() - interval '10 minutes'),
    'min_desde_ultima', (select round(extract(epoch from now() - max(rec.start_time)) / 60.0, 1)
                    from rec),
    'tareas', coalesce((select jsonb_agg(jsonb_build_object(
                  'nombre', j.jobname, 'cada', j.schedule,
                  'ultima_min', round(extract(epoch from now() - u.ult) / 60.0, 1),
                  'ultimo_estado', u.estado))
               from cron.job j
               left join lateral (
                 select rec.start_time ult, rec.status estado from rec
                  where rec.jobid = j.jobid order by rec.start_time desc limit 1) u on true
               where j.active), '[]'::jsonb))
  into v_cron;
  r := r || jsonb_build_object('cron', v_cron);

  -- Fichajes: turnos que arrancaron hace entre 30 min y 3 h sin ningún fichaje.
  -- Línea de base 11–18/11: 0 casos por hora. Alarma sólo si es masivo.
  select count(*),
         count(*) filter (where not exists (
           select 1 from public.registros_asistencia ra where ra.turno_id = t.id))
    into v_turnos, v_sin_fichaje
    from public.turnos t
   where t.estado <> 'anulado'
     and t.fecha between (v_ahora_ar::date - 1) and v_ahora_ar::date
     and (t.fecha + t.hora_inicio) between v_ahora_ar - interval '3 hours'
                                       and v_ahora_ar - interval '30 minutes';
  r := r || jsonb_build_object('fichajes', jsonb_build_object(
    'turnos_ventana', v_turnos, 'sin_fichaje', v_sin_fichaje));

  -- Telemetría de los teléfonos: ingresos iniciados vs confirmados (30 min).
  select count(*) filter (where e.event_name = 'ingreso_started'),
         count(*) filter (where e.event_name = 'ingreso_confirmed')
    into v_ing_ini, v_ing_ok
    from public.os_events e
   where e.created_at > now() - interval '30 minutes'
     and e.event_name in ('ingreso_started', 'ingreso_confirmed');
  r := r || jsonb_build_object('ingresos_app', jsonb_build_object(
    'iniciados_30m', v_ing_ini, 'confirmados_30m', v_ing_ok));

  return r || jsonb_build_object('ts', now());
end
$fn$;

comment on function public.monitor_salud() is
  'Vigía externo (/api/salud): cifras agregadas de salud. Sólo lectura. Incidente 18/11/2026.';

revoke all on function public.monitor_salud() from public, anon, authenticated;
grant execute on function public.monitor_salud() to service_role;

commit;
