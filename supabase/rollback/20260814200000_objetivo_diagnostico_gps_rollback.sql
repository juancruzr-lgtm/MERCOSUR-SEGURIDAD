-- ============================================================================
-- ROLLBACK · Diagnóstico GPS de objetivos
-- ============================================================================
--
-- NO EJECUTAR JUNTO CON LA MIGRACIÓN. Este archivo deshace, no instala.
--
-- La migración no tocó ninguna tabla preexistente: sólo agregó una tabla nueva
-- y una función. Por eso la etapa A es apagar la función y nada más.
--
-- ADVERTENCIA: si ya se aplicó alguna sugerencia, existen filas en
-- objetivos_auditoria con origen 'diagnostico_gps' y una firma que apunta a
-- esta tabla. La etapa B deja esas firmas sin destino. Las ubicaciones ya
-- aplicadas NO se revierten: eso es corrección de datos aparte, y se hace con
-- los valores que la propia auditoría conserva.
-- ============================================================================

-- ── ETAPA A · Apagar el diagnóstico (conserva lo calculado) ─────────────────

begin;

drop function if exists public.diagnosticar_gps_objetivo(uuid, integer);

notify pgrst, 'reload schema';

commit;

-- ── ETAPA B · Destruir los diagnósticos (opcional, irreversible) ────────────
-- Descomentar SÓLO tras verificar que no hay auditoría apuntando a estas firmas:
--
--   select count(*) from public.objetivos_auditoria
--   where origen = 'diagnostico_gps';
--
-- begin;
--
-- drop policy if exists "Admin supervisor lee diagnosticos gps de objetivos de su alcance"
--   on public.objetivo_diagnosticos_gps;
--
-- drop table if exists public.objetivo_diagnosticos_gps;
--
-- notify pgrst, 'reload schema';
--
-- commit;
