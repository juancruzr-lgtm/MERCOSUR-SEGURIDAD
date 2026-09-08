begin;
delete from public.liquidacion_concepto_permanente
 where motivo = 'padrón inicial auditado de Visual (ago-2026)' and vigencia_desde = date '2026-08-01';
commit;
