-- Rollback de 20261216150000_vigia_salud.sql
-- Antes: desactivar el workflow .github/workflows/vigia.yml (o el vigía abrirá
-- un incidente "base" al no encontrar salud_ping) y revertir /api/salud.
begin;
drop function if exists public.monitor_salud();
drop function if exists public.salud_ping();
commit;
