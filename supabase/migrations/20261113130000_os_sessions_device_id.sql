-- ============================================================================
-- Telemetría: identificador anónimo de dispositivo en os_sessions
-- ============================================================================
-- ESTADO: SIN APLICAR. Requiere aprobación expresa (AGENTS.md).
--
-- lib/telemetry.ts genera un UUID al azar por navegador (localStorage
-- 'mercosur.device_id.v1') y lo manda al abrir sesión. No deriva de ningún
-- dato del teléfono ni de la persona. Sirve para ver teléfonos compartidos y
-- para cruzar problemas de un mismo aparato entre sesiones.
-- Mientras la columna no exista, el cliente reintenta el INSERT sin ella.
--
-- Rollback: supabase/rollback/20261113130000_os_sessions_device_id_rollback.sql
-- ============================================================================

begin;

alter table public.os_sessions add column if not exists device_id text;

alter table public.os_sessions drop constraint if exists os_sessions_device_id_formato;
alter table public.os_sessions add constraint os_sessions_device_id_formato
  check (device_id is null or device_id ~* '^[0-9a-f-]{36}$');

create index if not exists os_sessions_device_id_idx
  on public.os_sessions (device_id, started_at desc) where device_id is not null;

comment on column public.os_sessions.device_id is
  'UUID anónimo por navegador (localStorage). No identifica a la persona ni al equipo físico.';

commit;
