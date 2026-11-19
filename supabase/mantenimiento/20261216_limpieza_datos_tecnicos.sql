-- ============================================================================
-- Limpieza de DATOS TÉCNICOS (telemetría e historial de crons)
-- NO SE EJECUTA SOLO. NO es una migración. Requiere autorización de Gerencia.
-- Preparado 18/11/2026 (seguimiento de la caída por Disk IO).
-- ============================================================================
-- QUÉ TOCA (sólo esto):
--   * cron.job_run_details  : historial de ejecuciones de pg_cron. Retención 7 días.
--   * public.os_events      : telemetría de la app (clicks, errores, GPS). Retención 90 días
--                             (= ventana máxima de /api/obs/sessions y /api/obs/usage).
--   * public.os_sessions    : sesiones de telemetría. Retención 90 días y sólo si
--                             ya no quedan eventos de esa sesión.
--
-- QUÉ NO TOCA NUNCA: fichajes (registros_asistencia), turnos, supervisiones,
-- evidencias, evaluaciones, liquidaciones, legajo, repositorio_documental,
-- supervisor_route_points (lo usan legajo operativo y hoja de ruta de
-- supervisores), whatsapp_mensaje_estados (constancia de entrega de avisos),
-- auth.audit_log_entries (auditoría de seguridad, la administra Supabase Auth).
--
-- ESPACIO: un DELETE no achica los archivos; deja el espacio libre DENTRO de la
-- tabla para nuevas filas (la tabla deja de crecer). Para devolverlo al disco
-- hace falta VACUUM FULL (bloquea la tabla mientras corre; ver paso 4).
--
-- CÓMO USAR: correr el PASO 0 (sólo cuenta). Si los números son los esperados
-- y hay autorización, correr los pasos 1–3 en horario de baja actividad
-- (03:00–05:00 AR). Cada lote es una transacción corta (no traba la app).
-- ============================================================================


-- ── PASO 0 · DRY-RUN (sólo lectura) ─────────────────────────────────────────
select 'cron.job_run_details > 7 días' as que, count(*) as filas
  from cron.job_run_details where end_time < now() - interval '7 days'
union all
select 'os_events > 90 días', count(*)
  from public.os_events where created_at < now() - interval '90 days'
union all
select 'os_sessions > 90 días sin eventos', count(*)
  from public.os_sessions s
 where s.created_at < now() - interval '90 days'
   and not exists (select 1 from public.os_events e
                    where e.session_id = s.id and e.created_at >= now() - interval '90 days');
-- Referencia 18/11/2026: ~97.300 / ~29.400 / ~10.000 filas.


-- ── PASO 1 · historial de crons (lotes de 5.000) ────────────────────────────
-- Repetir hasta que informe 0.
with lote as (
  select runid from cron.job_run_details
   where end_time < now() - interval '7 days'
   order by runid
   limit 5000
)
delete from cron.job_run_details d using lote where d.runid = lote.runid;


-- ── PASO 2 · telemetría os_events (lotes de 5.000) ──────────────────────────
-- Repetir hasta que informe 0.
with lote as (
  select id from public.os_events
   where created_at < now() - interval '90 days'
   order by created_at
   limit 5000
)
delete from public.os_events e using lote where e.id = lote.id;


-- ── PASO 3 · sesiones de telemetría sin eventos (lotes de 5.000) ────────────
with lote as (
  select s.id from public.os_sessions s
   where s.created_at < now() - interval '90 days'
     and not exists (select 1 from public.os_events e where e.session_id = s.id)
   limit 5000
)
delete from public.os_sessions s using lote where s.id = lote.id;


-- ── PASO 4 · liberar espacio (opcional, 03:00–05:00 AR) ─────────────────────
-- VACUUM normal: no bloquea, deja el espacio reutilizable. Recomendado siempre.
-- vacuum (analyze) cron.job_run_details;
-- vacuum (analyze) public.os_events;
-- vacuum (analyze) public.os_sessions;
--
-- VACUUM FULL: devuelve el espacio al disco pero BLOQUEA la tabla mientras
-- corre (segundos con estos tamaños). En os_events bloquea la telemetría de los
-- teléfonos (no los fichajes). Sólo si hace falta espacio:
-- vacuum full cron.job_run_details;


-- ── PASO 5 · retención automática del historial de crons (propuesta) ────────
-- Una vez aprobada la limpieza, para que no vuelva a crecer:
-- select cron.schedule('purgar-historial-cron', '15 3 * * *',
--   $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
