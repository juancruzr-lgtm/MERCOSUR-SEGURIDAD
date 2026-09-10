-- ============================================================================
-- ROLLBACK · LIQ EXPORTACIÓN ATÓMICA (20260910130000)
-- ============================================================================
-- Elimina la función nueva. No toca datos, ni las RPC viejas (siguen intactas),
-- ni tablas. Tras el rollback, la UI vieja (consolidar_periodo +
-- registrar_enviado_visual + marcar_exportada_visual) sigue operando; sólo se
-- pierde el atajo atómico. Los datos ya escritos por la función (consolidada /
-- enviado / estado exportada) NO se revierten: son datos de negocio válidos.
-- ============================================================================

begin;

drop function if exists public.exportar_liquidacion_periodo(uuid, jsonb, jsonb);

notify pgrst, 'reload schema';

commit;
