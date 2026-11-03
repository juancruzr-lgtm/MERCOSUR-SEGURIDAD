-- Rollback de 20261201150000 (condiciones comerciales, vencimientos, intereses, emisión manual).
-- SE PIERDE: fechas de presentación/recepción/conformidad, vencimientos manuales,
-- intereses propuestos/aprobados y las condiciones de pago y mora de los contratos.
-- Los comprobantes registrados manualmente NO se borran (son fiscales).
begin;
drop function if exists public.fact_comprobante_manual_registrar(uuid, integer, jsonb);
drop function if exists public.fact_emisor_guardar(jsonb);
drop function if exists public.fact_alcance_total_actual();
delete from public.fact_config where clave = 'emisor';
drop function if exists public.fact_tablero_vencimientos(text, date, uuid, uuid);
drop function if exists public.fact_vencimientos(date, uuid, uuid);
drop function if exists public.fact_seguimiento_registrar(uuid, jsonb);
drop function if exists public.fact_contrato_condiciones_guardar(uuid, jsonb);
drop function if exists public.fact_interes_solicitar_nd(uuid, bigint, text);
drop function if exists public.fact_interes_anular(uuid, text);
drop function if exists public.fact_interes_aprobar(uuid);
drop function if exists public.fact_interes_revisar(uuid, text);
drop function if exists public.fact_interes_proponer(uuid, date);
drop function if exists public.fact_interes_simular(uuid, date);
drop function if exists public.fact_interes_calcular(uuid, date);
drop function if exists public.fact_movimientos_saldo(uuid);
drop function if exists public.fact_vencimiento_comercial(uuid);
drop function if exists public.fact_contrato_de_comprobante(uuid);
drop table if exists public.fact_intereses;
drop table if exists public.fact_comprobante_seguimiento;
alter table public.fact_contratos drop constraint if exists fact_contratos_fecha_fija;
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_completa;
alter table public.fact_contratos
  drop column if exists condiciones_documento_id,
  drop column if exists mora_condiciones,
  drop column if exists mora_gracia_dias,
  drop column if exists mora_metodo,
  drop column if exists mora_tasa_periodo,
  drop column if exists mora_tasa,
  drop column if exists pago_dia_mes,
  drop column if exists pago_evento;
commit;
notify pgrst, 'reload schema';
