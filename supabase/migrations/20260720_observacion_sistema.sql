-- ════════════════════════════════════════════════════════════════════
-- 20260720_observacion_sistema.sql
-- Módulo "Observación del Sistema" — Fase 1
--
-- Esta migración solo agrega registros a app_config.
-- No crea tablas nuevas: toda la infraestructura de la Fase 1
-- se apoya en tablas existentes (os_events, os_sessions,
-- registros_asistencia, supervisiones, novedades, turnos, usuarios,
-- objetivos, evidencias, registros_asistencia_auditoria).
-- ════════════════════════════════════════════════════════════════════

insert into app_config (key, value, description) values
  ('obs_enabled',
   'true',
   'Activa o desactiva el módulo Observación del Sistema para administradores.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('obs_events_page_size',
   '100',
   'Cantidad de eventos por página en el browser de telemetría del módulo Observación.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('obs_events_retention_days',
   '730',
   'Días de retención de os_events. Referencia para futuros jobs de limpieza.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('obs_quality_check_interval_hours',
   '24',
   'Frecuencia (en horas) con la que se recomienda ejecutar los chequeos de calidad de datos.')
on conflict (key) do nothing;
