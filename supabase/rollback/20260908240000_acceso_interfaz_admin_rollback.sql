begin;
alter table public.usuarios drop column if exists acceso_interfaz_admin;
commit;
