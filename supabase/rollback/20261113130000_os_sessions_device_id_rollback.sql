-- Rollback de 20261113130000_os_sessions_device_id.sql.
-- El cliente sigue funcionando: si el INSERT falla por device_id, reintenta sin ella.
begin;
drop index if exists public.os_sessions_device_id_idx;
alter table public.os_sessions drop constraint if exists os_sessions_device_id_formato;
alter table public.os_sessions drop column if exists device_id;
commit;
