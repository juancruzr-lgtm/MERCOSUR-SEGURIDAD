-- ============================================================================
-- ROLLBACK · Auditoría de cambios sensibles en ronda_puntos
-- ============================================================================
--
-- DOS ETAPAS. La etapa A es la que se ejecuta ante un problema: apaga el
-- mecanismo y deja el sistema exactamente como estaba antes, PERO conserva el
-- historial ya registrado. La etapa B destruye ese historial y está comentada
-- a propósito: descomentarla es una decisión, no un paso del rollback.
--
-- Después de la etapa A, ronda_puntos vuelve a tener exactamente los mismos
-- triggers, columnas y grants que antes de la migración.
-- ============================================================================

-- ── ETAPA A · Revertir el mecanismo (no destruye auditoría) ─────────────────

begin;

drop trigger if exists trg_ronda_puntos_zz_auditoria on public.ronda_puntos;
drop function if exists public.ronda_puntos_auditar_cambio();

-- Los grants por columna se van solos con la columna.
alter table public.ronda_puntos
  drop constraint if exists ronda_puntos_ctx_cambio_en_reposo;

alter table public.ronda_puntos
  drop column if exists ctx_cambio_origen,
  drop column if exists ctx_cambio_firma;

-- La tabla de auditoría queda: es evidencia, no infraestructura.
-- Sin el trigger no recibe filas nuevas; sigue siendo legible para admin y
-- supervisor de alcance.

notify pgrst, 'reload schema';

commit;

-- ── ETAPA B · Destruir el historial (opcional, irreversible) ────────────────
-- Descomentar SÓLO si se decide que el historial no debe conservarse.
--
-- begin;
--
-- drop policy if exists "Admin supervisor lee auditoria de puntos de su alcance"
--   on public.ronda_puntos_auditoria;
--
-- drop table if exists public.ronda_puntos_auditoria;
--
-- notify pgrst, 'reload schema';
--
-- commit;
