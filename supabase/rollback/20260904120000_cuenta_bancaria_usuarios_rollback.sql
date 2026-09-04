-- Rollback de 20260904120000_cuenta_bancaria_usuarios.sql
-- ARCHIVO APARTE, NUNCA se ejecuta junto a la migración.
-- Elimina la columna y con ella los datos cargados por saneamiento.

begin;

alter table public.usuarios
  drop column if exists cuenta_bancaria;

notify pgrst, 'reload schema';

commit;
