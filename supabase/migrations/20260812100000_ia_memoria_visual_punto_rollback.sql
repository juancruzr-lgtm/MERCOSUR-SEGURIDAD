-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — MEMORIA VISUAL POR PUNTO DE RONDA
--
-- Revierte 20260812100000_ia_memoria_visual_punto.sql.
--
-- AVISO: dropear `ronda_punto_id` borra el vínculo denormalizado. No se pierde
-- información real —se puede reconstruir con el mismo backfill de la migración—
-- pero cualquier análisis de ronda hecho mientras tanto queda sin memoria visual
-- hasta que se vuelva a aplicar y re-backfillear.
--
-- Las revisiones humanas (revision_estado) NO se tocan: viven en evidencia_analisis
-- y en evidencia_analisis_revisiones, y ninguna de las dos se modifica acá.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop view if exists public.ia_metricas_punto;

drop index if exists public.idx_evidencia_analisis_punto_revision;

alter table public.evidencia_analisis
  drop column if exists ronda_punto_id;

delete from public.app_config
where key in (
  'ia_memoria_max_positivos',
  'ia_memoria_max_negativos',
  'ia_memoria_minimo_historial'
);

-- ia_ronda_solo_gps_fuera_radio NO se borra a propósito: con la clave ausente el
-- cron vuelve a leerla como true y pasa a analizar sólo las fotos con GPS fuera
-- de radio, que es justamente el comportamiento que esta migración corrigió.
-- Si querés revertirlo también, hacelo explícito:
--   delete from public.app_config where key = 'ia_ronda_solo_gps_fuera_radio';

commit;
