-- Rollback de 20261213160000_facturacion_corregir_texto_comprobante.sql
-- Se pierden los textos corregidos (quedan en fact_historial). Los PDF generados con texto corregido siguen
-- en el storage y en fact_documentos; sus vínculos vigentes se anulan para que el PDF vuelva a salir con el
-- texto de la prefactura.
begin;
update public.fact_documento_vinculos vi
   set anulado_at = now(), anulado_motivo = 'Rollback: vuelve el texto de la prefactura'
  from public.fact_documentos d, public.fact_comprobantes c
 where d.id = vi.documento_id and d.tipo = 'factura' and vi.entidad = 'comprobante'
   and vi.entidad_id = c.id and vi.anulado_at is null and c.texto_pdf_version > 0;
drop function if exists public.fact_comprobante_corregir_texto(uuid, text, jsonb, text);
alter table public.fact_comprobantes
  drop column if exists texto_pdf,
  drop column if exists conceptos_pdf,
  drop column if exists texto_pdf_version;
commit;
