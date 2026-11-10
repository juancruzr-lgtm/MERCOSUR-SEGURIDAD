-- Rollback de 20261208100100_accesos_password.sql
-- Las contraseñas NO se tocan (viven en Supabase Auth). Se pierde el historial
-- de cambios y la marca de cambio obligatorio: exportarlos antes si tienen filas.
begin;
drop function if exists public.accesos_password_estado();
drop function if exists public.accesos_marcar_cambio_obligatorio(uuid[], boolean);
drop function if exists public.mi_acceso_registrar_cambio();
drop function if exists public.mi_acceso_password();
drop function if exists public.acceso_password_es_dni(uuid);
drop trigger if exists trg_accesos_password_eventos_inmutable on public.accesos_password_eventos;
drop function if exists public.accesos_password_eventos_inmutable();
drop table if exists public.accesos_password_eventos;
drop table if exists public.accesos_password;
commit;
