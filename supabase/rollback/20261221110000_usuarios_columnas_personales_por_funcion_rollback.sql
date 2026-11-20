-- Rollback de 20261221110000_usuarios_columnas_personales_por_funcion.sql
grant select (dni, cuil, telefono) on public.usuarios to authenticated;
