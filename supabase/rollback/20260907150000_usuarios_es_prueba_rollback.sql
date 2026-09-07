-- Rollback de 20260907150000_usuarios_es_prueba.sql
-- Elimina la columna es_prueba de usuarios. No toca ninguna otra columna ni
-- fila. Ojo: el código posterior a PR #168 tolera la ausencia de la columna
-- (select('*') simplemente no la trae), así que el rollback es seguro.

begin;

alter table public.usuarios drop column if exists es_prueba;

commit;
