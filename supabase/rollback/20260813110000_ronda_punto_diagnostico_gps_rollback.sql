-- ============================================================================
-- ROLLBACK · Diagnóstico GPS de un punto de control
-- ============================================================================
--
-- Este rollback es más simple que el de la auditoría porque la migración no
-- tocó ninguna tabla preexistente: sólo agregó una tabla nueva y una función.
--
-- DOS ETAPAS, mismo criterio: la etapa A apaga el mecanismo; la etapa B destruye
-- los diagnósticos guardados y está comentada.
--
-- ADVERTENCIA DE ORDEN: si ya se aplicó alguna sugerencia, existen filas en
-- ronda_puntos_auditoria con origen = 'diagnostico_gps' y una firma que apunta
-- a esta tabla. Ejecutar la etapa B deja esas firmas sin destino. Los cambios
-- aplicados a los puntos NO se revierten: eso es una corrección de datos aparte
-- y se hace con los valores que la propia auditoría conserva.
-- ============================================================================

-- ── ETAPA A · Revertir el mecanismo (conserva los diagnósticos) ─────────────

begin;

drop function if exists public.diagnosticar_gps_ronda_punto(uuid, integer);

notify pgrst, 'reload schema';

commit;

-- ── ETAPA B · Destruir los diagnósticos (opcional, irreversible) ────────────
-- Descomentar SÓLO tras verificar que no hay auditoría apuntando a estas firmas:
--
--   select count(*) from public.ronda_puntos_auditoria
--   where origen = 'diagnostico_gps';
--
-- begin;
--
-- drop policy if exists "Admin supervisor lee diagnosticos gps de su alcance"
--   on public.ronda_punto_diagnosticos_gps;
--
-- drop table if exists public.ronda_punto_diagnosticos_gps;
--
-- notify pgrst, 'reload schema';
--
-- commit;
