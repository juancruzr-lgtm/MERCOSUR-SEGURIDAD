-- Permite registrar deduplicacion de notificaciones por objetivo (alertas
-- de supervision), ademas de por turno (alertas de turno/asistencia, sin
-- cambios). No se modifica ninguna fila existente: turno_id sigue siendo
-- obligatorio para las notificaciones que ya lo usan, solo se relaja la
-- restriccion NOT NULL para permitir el nuevo caso objetivo_id.

alter table notificaciones_enviadas
  alter column turno_id drop not null;

alter table notificaciones_enviadas
  add column if not exists objetivo_id uuid references objetivos(id) on delete cascade;

create unique index if not exists notificaciones_enviadas_usuario_objetivo_tipo_key
  on notificaciones_enviadas (usuario_id, objetivo_id, tipo)
  where objetivo_id is not null;

create index if not exists idx_notificaciones_enviadas_objetivo
  on notificaciones_enviadas (objetivo_id);
