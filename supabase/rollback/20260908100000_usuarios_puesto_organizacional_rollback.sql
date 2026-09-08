-- ROLLBACK de 20260908100000_usuarios_puesto_organizacional.sql
-- Quita la columna y su constraint. Como no hubo backfill, no se pierde ningún
-- dato operativo (todas las filas estaban en null). No toca usuarios.rol.
begin;

alter table public.usuarios
  drop constraint if exists usuarios_puesto_organizacional_check;

alter table public.usuarios
  drop column if exists puesto_organizacional;

commit;
