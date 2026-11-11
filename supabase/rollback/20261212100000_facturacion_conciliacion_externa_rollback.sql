-- Rollback de 20261212100000_facturacion_conciliacion_externa (correr APARTE, nunca junto a la migración).
-- Quita las funciones y la columna. Las prefacturas ya conciliadas quedan 'emitida' y los comprobantes
-- vinculados (prefactura_id) se conservan: sólo se pierde el detalle de la diferencia (también queda en
-- fact_historial, acción 'conciliada').
drop function if exists public.fact_excepcion_duplicado(uuid, text);
drop function if exists public.fact_conciliacion_diferencia(uuid, text, text, jsonb);
drop function if exists public.fact_prefactura_conciliar(uuid, integer, uuid, jsonb);
alter table public.fact_prefacturas drop column if exists conciliacion;
