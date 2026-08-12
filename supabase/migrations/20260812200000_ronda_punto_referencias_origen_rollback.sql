-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — ORIGEN DE LAS REFERENCIAS DE PUNTO
--
-- Revierte 20260812200000_ronda_punto_referencias_origen.sql.
--
-- Al dropear `origen`, la ruta de promoción vuelve a su comportamiento anterior
-- —nunca reemplaza una referencia activa, venga de donde venga— porque la
-- decisión trata el origen desconocido como 'manual'. Es el lado seguro.
--
-- Ninguna referencia se borra ni se desactiva. El histórico de vigencias que se
-- haya generado mientras tanto queda intacto: las referencias reemplazadas
-- siguen ahí con su vigente_hasta.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop index if exists public.idx_ronda_punto_referencias_activa_origen;

alter table public.ronda_punto_referencias
  drop constraint if exists ronda_punto_referencias_origen_valido;

alter table public.ronda_punto_referencias
  drop column if exists origen;

commit;
