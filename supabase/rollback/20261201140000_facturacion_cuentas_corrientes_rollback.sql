-- Rollback de 20261201140000 (cuentas corrientes, conciliación, tablero).
-- SE PIERDE: saldos iniciales, movimientos bancarios importados, cobros,
-- retenciones, propuestas y aplicaciones. Exportar antes si hay datos reales.
begin;
drop function if exists public.fact_tablero(text, date);
drop function if exists public.fact_propuesta_rechazar(uuid, text);
drop function if exists public.fact_propuesta_aceptar(uuid);
drop function if exists public.fact_propuestas_guardar(uuid, jsonb);
drop function if exists public.fact_retencion_certificar(uuid, text, bigint, uuid);
drop function if exists public.fact_retencion_registrar(jsonb);
drop function if exists public.fact_cheque_estado(uuid, text, text);
drop function if exists public.fact_cobro_anular(uuid, text);
drop function if exists public.fact_cobro_registrar(jsonb);
drop function if exists public.fact_movimiento_clasificar(uuid, text, text);
drop function if exists public.fact_extracto_importar(text, text, text, uuid, jsonb);
drop function if exists public.fact_saldo_inicial_registrar(uuid, date, bigint, text, uuid);
drop function if exists public.fact_aplicacion_revertir(uuid, text);
drop function if exists public.fact_aplicar(text, uuid, uuid, uuid, bigint, jsonb);
drop function if exists public.fact_aplicar_interno(uuid, text, uuid, uuid, uuid, bigint, text, jsonb, uuid);
drop function if exists public.fact_saldo_destino(uuid, uuid);
drop view if exists public.fact_v_saldos;
drop table if exists public.fact_aplicaciones;
drop table if exists public.fact_propuestas;
drop table if exists public.fact_retenciones;
drop table if exists public.fact_cobros;
drop table if exists public.fact_movimientos_bancarios;
drop table if exists public.fact_saldos_iniciales;
commit;
notify pgrst, 'reload schema';
