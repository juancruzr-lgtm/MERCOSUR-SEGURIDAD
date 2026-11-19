-- Rollback de 20261216100000_ia_control_imagenes_conteos.sql
-- Ojo: antes de correrlo, volver el panel (ControlImagenesIAPanel) a la
-- versión de 9 conteos, o el Dashboard muestra el error del panel.
begin;
drop function if exists public.ia_control_imagenes_conteos();
commit;
