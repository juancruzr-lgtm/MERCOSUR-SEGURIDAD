-- Rollback de 20261213110000_facturacion_renglones_texto_horas_facturar.sql
-- OJO: se pierden los textos de renglón y las horas a facturar cargadas (quedan en fact_historial).
-- Las prefacturas ya calculadas conservan sus renglones hasta el próximo recálculo; las emitidas no cambian.
begin;
drop function if exists public.fact_horas_facturar(uuid, integer, text);
drop function if exists public.fact_contrato_objetivo_texto(uuid, text);
alter table public.fact_horas_aprobaciones drop constraint if exists fact_horas_aprobaciones_minutos_facturar_check;
alter table public.fact_horas_aprobaciones
  drop column if exists facturar_at,
  drop column if exists facturar_por,
  drop column if exists facturar_motivo,
  drop column if exists minutos_facturar;
alter table public.fact_contrato_objetivos drop constraint if exists fact_contrato_objetivos_texto_renglon_largo;
alter table public.fact_contrato_objetivos drop column if exists texto_renglon;
commit;
