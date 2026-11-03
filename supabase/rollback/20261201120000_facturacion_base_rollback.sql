-- Rollback de 20261201120000 (facturación base).
-- Requiere haber revertido antes 20261201140000 y 20261201130000.
-- SE PIERDE: clientes, alias, contactos, contratos, tarifas, OC, documentos
-- (los archivos quedan en el bucket facturacion-documentos, que NO se borra),
-- horas aprobadas, prefacturas, ajustes, envíos, conformidades e historial.
begin;
do $do$
declare f text;
begin
  foreach f in array array[
    'fact_conformidad_registrar(uuid, jsonb)', 'fact_envio_registrar(uuid, jsonb)', 'fact_ajuste_resolver(uuid, boolean, text)',
    'fact_ajuste_agregar(uuid, text, bigint, text)', 'fact_prefactura_aprobar(uuid, integer)', 'fact_prefactura_estado(uuid, text, integer, text)',
    'fact_prefactura_texto(uuid, text, integer)', 'fact_prefactura_guardar(uuid, jsonb, integer)',
    'fact_horas_aprobar(uuid, uuid, date, date, jsonb, jsonb, text, boolean)', 'fact_documento_desvincular(uuid, text)',
    'fact_documento_vincular(uuid, text, uuid)', 'fact_documento_revisar(uuid, text, jsonb, uuid)', 'fact_documento_registrar(jsonb)',
    'fact_oc_guardar(uuid, jsonb, uuid[], integer)', 'fact_tarifa_agregar(uuid, uuid, text, numeric, text, numeric, date, text)',
    'fact_contrato_objetivo_vincular(uuid, uuid, date, date)', 'fact_contrato_guardar(uuid, jsonb, integer)', 'fact_contacto_guardar(uuid, jsonb)',
    'fact_alias_anular(uuid, text)', 'fact_alias_guardar(uuid, text, text, boolean, text)', 'fact_cliente_guardar(uuid, jsonb, integer)']
  loop
    execute format('drop function if exists public.%s', f);
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists fact_docs_lectura on storage.objects';
    execute 'drop policy if exists fact_docs_alta on storage.objects';
  end if;
end
$do$;
drop table if exists public.fact_conformidades;
drop table if exists public.fact_envios;
drop table if exists public.fact_ajustes;
drop table if exists public.fact_oc_consumos;
drop trigger if exists fact_prefactura_antes_guardar on public.fact_prefacturas;
drop function if exists public.fact_prefactura_huella(public.fact_prefacturas);
drop table if exists public.fact_prefacturas;
drop function if exists public.fact_prefactura_antes_guardar();
drop table if exists public.fact_horas_aprobaciones;
drop table if exists public.fact_oc_objetivos;
drop table if exists public.fact_ordenes_compra;
drop table if exists public.fact_documento_vinculos;
drop table if exists public.fact_documentos;
drop table if exists public.fact_tarifas;
drop table if exists public.fact_contrato_objetivos;
drop table if exists public.fact_contratos;
drop table if exists public.fact_contactos;
drop table if exists public.fact_cliente_alias;
drop table if exists public.fact_clientes;
drop table if exists public.fact_historial;
drop function if exists public.fact_historial_inmutable();
drop function if exists public.fact_registrar(text, uuid, text, jsonb, uuid);
drop function if exists public.fact_cuit_valido(text);
drop function if exists public.facturacion_gate();
drop function if exists public.facturacion_actor();
drop function if exists public.facturacion_puede_actual();
commit;
notify pgrst, 'reload schema';
