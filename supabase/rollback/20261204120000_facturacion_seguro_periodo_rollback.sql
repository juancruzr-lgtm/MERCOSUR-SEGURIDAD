-- Rollback de 20261204120000_facturacion_seguro_periodo: quita el seguro de períodos y el registro de operaciones.
-- No toca prefacturas ni aprobaciones. El historial de excepciones queda en fact_historial.
begin;
drop trigger if exists fact_periodo_proteger on public.fact_prefacturas;
drop trigger if exists fact_periodo_proteger on public.fact_horas_aprobaciones;
drop function if exists public.fact_periodo_proteger();
drop function if exists public.fact_operacion_terminar(uuid, text, jsonb);
drop function if exists public.fact_operacion_iniciar(text, text, uuid);
drop function if exists public.fact_periodo_estado(text);
drop function if exists public.fact_periodo_excepcion_revocar(uuid, text);
drop function if exists public.fact_periodo_excepcion_otorgar(text, text, integer);
drop function if exists public.fact_periodo_escritura_habilitada(text);
drop function if exists public.fact_mes_actual();
drop table if exists public.fact_operaciones;
drop table if exists public.fact_periodo_excepciones;
commit;
