-- ============================================================================
-- ROLLBACK · Auditoría de ubicación y radio de objetivos
-- ============================================================================
--
-- NO EJECUTAR JUNTO CON LA MIGRACIÓN. Este archivo deshace, no instala.
--
-- DOS ETAPAS. La etapa A es la que se corre ante un problema: apaga el
-- mecanismo y deja objetivos exactamente como estaba antes, pero CONSERVA el
-- historial ya registrado. La etapa B destruye ese historial y está comentada
-- a propósito: descomentarla es una decisión, no un paso del rollback.
-- ============================================================================

-- ── ETAPA A · Revertir el mecanismo (no destruye auditoría) ─────────────────

begin;

drop trigger if exists trg_objetivos_zz_auditoria on public.objetivos;
drop function if exists public.objetivos_auditar_cambio();

alter table public.objetivos
  drop constraint if exists objetivos_ctx_cambio_en_reposo;

alter table public.objetivos
  drop column if exists ctx_cambio_origen,
  drop column if exists ctx_cambio_firma;

-- La tabla de auditoría queda: es evidencia, no infraestructura.

notify pgrst, 'reload schema';

commit;

-- ── ETAPA B · Destruir el historial (opcional, irreversible) ────────────────
-- Descomentar SÓLO si se decide que el historial no debe conservarse.
--
-- begin;
--
-- drop policy if exists "Admin supervisor lee auditoria de objetivos de su alcance"
--   on public.objetivos_auditoria;
--
-- drop table if exists public.objetivos_auditoria;
--
-- notify pgrst, 'reload schema';
--
-- commit;
