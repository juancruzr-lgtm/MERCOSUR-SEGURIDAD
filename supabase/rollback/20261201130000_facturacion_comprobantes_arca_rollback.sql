-- Rollback de 20261201130000 (comprobantes, emisión ARCA, importación, portal).
-- Requiere haber revertido antes 20261201140000.
-- SE PIERDE: comprobantes registrados (incluidos los autorizados por ARCA:
-- siguen existiendo en ARCA, sólo se pierde su registro en la app),
-- solicitudes de emisión, importaciones y presentaciones en portal.
begin;
drop function if exists public.fact_modulo_exigir(text);
drop function if exists public.fact_portal_registrar(uuid, jsonb);
drop function if exists public.fact_comprobante_asociar(uuid, uuid, uuid, uuid, text);
drop function if exists public.fact_importacion_cerrar(uuid, text);
drop function if exists public.fact_importacion_arca_confirmar(uuid, text[]);
drop function if exists public.fact_importacion_arca_crear(text, text, uuid, jsonb);
drop function if exists public.fact_emision_consulta(uuid, boolean, jsonb, text, date, date, bigint, bigint);
drop function if exists public.fact_emision_resultado(uuid, text, jsonb, text, date, date, text);
drop function if exists public.fact_emision_autorizar_interno(public.fact_emisiones, text, date, date, jsonb);
drop function if exists public.fact_emision_iniciar_envio(uuid, bigint, jsonb);
drop function if exists public.fact_nota_aprobar(uuid);
drop function if exists public.fact_nota_solicitar(uuid, integer, bigint, bigint, text, text);
drop function if exists public.fact_emision_preparar(uuid, integer, text);
drop function if exists public.fact_letra(integer);
drop function if exists public.fact_saldo_fiscal(uuid);
drop table if exists public.fact_portal_presentaciones;
drop table if exists public.fact_emisiones;
drop table if exists public.fact_importacion_filas;
drop trigger if exists fact_comprobante_inmutable on public.fact_comprobantes;
drop trigger if exists fact_comprobante_inmutable_trunc on public.fact_comprobantes;
drop table if exists public.fact_comprobantes;
drop function if exists public.fact_comprobante_inmutable();
drop table if exists public.fact_importaciones;
drop table if exists public.fact_config;
commit;
notify pgrst, 'reload schema';
