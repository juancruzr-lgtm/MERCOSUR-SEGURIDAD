-- Facturación: corregir el texto de una factura ya emitida
--
-- CAUSA
-- El detalle de una factura emitida por la app (texto general y texto de cada renglón) sólo existe en el
-- PDF que arma la app: a ARCA (WSFE) se le informan importes, fechas, receptor y CAE, no el detalle. El
-- PDF se genera una vez con el texto de la prefactura y después se devuelve siempre el mismo archivo, así
-- que un error de redacción no tenía arreglo sin una nota de crédito.
--
-- CAMBIO
--   · fact_comprobantes.texto_pdf, conceptos_pdf (jsonb: un texto por renglón) y texto_pdf_version: texto
--     corregido del PDF. Con versión 0 el PDF usa el texto de la prefactura, como hasta ahora.
--   · fact_comprobante_corregir_texto(p_id, p_texto, p_conceptos, p_motivo): sólo Gerencia o
--     Administración (facturacion_gate), sólo comprobantes emitidos por la app con CAE. Exige el mismo
--     número de renglones que tiene el PDF (no agrega ni quita renglones) y un motivo de al menos 10
--     caracteres. NO toca importes, cantidades, fechas, CAE ni receptor: el trigger
--     fact_comprobante_inmutable sigue bloqueando todo dato fiscal. Deja historial en fact_historial y
--     anula (sin borrar) el vínculo al PDF guardado, para que se genere uno nuevo con otro nombre; el
--     archivo anterior queda en el storage y en fact_documentos.
--
-- Aditiva. Reversible: supabase/rollback/20261213160000_facturacion_corregir_texto_comprobante_rollback.sql

alter table public.fact_comprobantes
  add column if not exists texto_pdf text,
  add column if not exists conceptos_pdf jsonb,
  add column if not exists texto_pdf_version integer not null default 0;

create or replace function public.fact_comprobante_corregir_texto(p_id uuid, p_texto text, p_conceptos jsonb, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor uuid := public.facturacion_gate();
  v public.fact_comprobantes;
  v_lineas jsonb;
  v_renglones integer;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_version integer;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explicá el motivo de la corrección (al menos 10 caracteres)';
  end if;
  select * into v from public.fact_comprobantes where id = p_id for update;
  if v.id is null then raise exception 'Comprobante inexistente'; end if;
  if v.origen <> 'emision_app' or v.cae is null then
    raise exception 'Sólo se corrige el texto de comprobantes emitidos por la app: los de Comprobantes en línea tienen el PDF de ARCA';
  end if;

  -- Mismos renglones que el PDF: los de la prefactura en facturas; uno solo en notas o sin renglones.
  if v.prefactura_id is not null then
    select lineas into v_lineas from public.fact_prefacturas where id = v.prefactura_id;
  end if;
  v_renglones := case when v.tipo in (1, 6, 201) and jsonb_typeof(v_lineas) = 'array' and jsonb_array_length(v_lineas) > 0
                      then jsonb_array_length(v_lineas) else 1 end;
  if p_conceptos is null or jsonb_typeof(p_conceptos) <> 'array' or jsonb_array_length(p_conceptos) <> v_renglones then
    raise exception 'Tiene que haber un texto por renglón (% renglones): no se agregan ni se quitan renglones', v_renglones;
  end if;
  if exists (select 1 from jsonb_array_elements(p_conceptos) e
              where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}') = '' or length(e #>> '{}') > 2000) then
    raise exception 'Cada renglón necesita un texto (máximo 2000 caracteres)';
  end if;
  if length(coalesce(v_texto, '')) > 4000 then raise exception 'El texto general admite hasta 4000 caracteres'; end if;

  if v.texto_pdf_version > 0 and v.texto_pdf is not distinct from v_texto and v.conceptos_pdf = p_conceptos then
    return v.texto_pdf_version;
  end if;

  update public.fact_comprobantes
     set texto_pdf = v_texto, conceptos_pdf = p_conceptos, texto_pdf_version = texto_pdf_version + 1
   where id = p_id
  returning texto_pdf_version into v_version;

  -- El PDF guardado deja de ser el vigente: se conserva el archivo y el vínculo queda anulado con su motivo.
  update public.fact_documento_vinculos vi
     set anulado_at = now(), anulado_por = v_actor, anulado_motivo = 'Texto corregido: ' || btrim(p_motivo)
    from public.fact_documentos d
   where d.id = vi.documento_id and d.tipo = 'factura'
     and vi.entidad = 'comprobante' and vi.entidad_id = p_id and vi.anulado_at is null;

  perform public.fact_registrar('comprobante', p_id, 'texto_pdf', jsonb_build_object(
    'version', v_version,
    'antes', jsonb_build_object('texto', v.texto_pdf, 'conceptos', v.conceptos_pdf, 'version', v.texto_pdf_version),
    'ahora', jsonb_build_object('texto', v_texto, 'conceptos', p_conceptos),
    'motivo', btrim(p_motivo)), v_actor);
  return v_version;
end $function$;

revoke all on function public.fact_comprobante_corregir_texto(uuid, text, jsonb, text) from public, anon;
grant execute on function public.fact_comprobante_corregir_texto(uuid, text, jsonb, text) to authenticated;
