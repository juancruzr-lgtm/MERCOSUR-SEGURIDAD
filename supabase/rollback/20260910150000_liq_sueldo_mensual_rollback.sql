-- ============================================================================
-- ROLLBACK · LIQ SUELDO MENSUAL (20260910150000)
-- ============================================================================
-- Elimina la tabla y las funciones. Borra los SUELDO MENSUAL cargados (datos de
-- negocio) — sólo revertir si el feature se descarta. No toca cálculos ni otras
-- tablas.
-- ============================================================================

begin;

drop function if exists public.set_sueldo_mensual(uuid, numeric, text);
drop function if exists public.sueldo_mensual_vigente(uuid, text);
drop table if exists public.liquidacion_sueldo_mensual;

notify pgrst, 'reload schema';

commit;
