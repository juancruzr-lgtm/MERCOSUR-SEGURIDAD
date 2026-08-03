-- Rollback: quita el campo CUIL de usuarios.
drop index if exists public.usuarios_cuil_unique;
alter table public.usuarios drop column if exists cuil;
