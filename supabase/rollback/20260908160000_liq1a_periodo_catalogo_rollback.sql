-- ROLLBACK de 20260908160000_liq1a_periodo_catalogo.sql
-- Elimina el módulo de liquidación LIQ1A (tablas, RPC, helper). DESTRUCTIVO de
-- los datos de liquidación cargados (no de datos operativos). Usar sólo si se
-- descarta el módulo entero.
begin;
drop function if exists public.crear_periodo_liquidacion(text);
drop table if exists public.liquidacion_concepto_periodo cascade;
drop table if exists public.liquidacion_concepto_permanente cascade;
drop table if exists public.liquidacion_concepto_catalogo cascade;
drop table if exists public.liquidacion_periodo_empleado cascade;
drop table if exists public.liquidacion_periodo cascade;
drop function if exists public.es_gerencia_actual();
commit;
