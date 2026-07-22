-- ════════════════════════════════════════════════════════════════════
-- 20260722_turnos_revisado.sql
--
-- Agrega dos columnas a `turnos` para registrar quién y cuándo
-- el supervisor / admin realizó el cierre definitivo del turno.
--
-- revisado_por → id del usuario en public.usuarios (no auth.users)
-- revisado_at  → timestamp del momento de revisión (UTC)
--
-- Ambas son nullable: NULL = aún no revisado por ningún supervisor.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.turnos
  ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES public.usuarios(id),
  ADD COLUMN IF NOT EXISTS revisado_at  timestamptz;
