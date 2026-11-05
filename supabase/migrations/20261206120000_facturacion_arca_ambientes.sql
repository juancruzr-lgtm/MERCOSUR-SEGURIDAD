-- Facturación ARCA: homologación y producción separadas en la emisión por API.
--  * Punto de venta por ambiente: fact_config.emision.punto_venta_prod / punto_venta_homo.
--    Sin valor por defecto (ya no se usa 'punto_venta' ni el de la prefactura).
--  * Producción: rechaza un punto de venta ya usado por Comprobantes en línea o carga manual.
--  * Homologación: CUIT emisor opcional propio (cuit_emisor_homo); si no está, el de producción.
-- No cambia datos: no toca cuit_emisor, las llaves de habilitación ni ningún comprobante.
-- Las protecciones contra duplicados (clave de idempotencia, emisión viva, comprobante ya registrado) quedan iguales.
begin;
create or replace function public.fact_emision_preparar(p_prefactura_id uuid, p_version integer, p_ambiente text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_prefacturas; v_cfg jsonb; v_id uuid; v_ex public.fact_emisiones; v_clave text; v_pv integer;
  v_clave_pv text := case p_ambiente when 'produccion' then 'punto_venta_prod' else 'punto_venta_homo' end; v_cuit text;
begin
  if p_ambiente not in ('produccion', 'homologacion') then raise exception 'Ambiente inválido'; end if;
  select valor into v_cfg from public.fact_config where clave = 'emision';
  if p_ambiente = 'produccion' and not coalesce((v_cfg->>'produccion_habilitada')::boolean, false) then
    raise exception 'La emisión real en ARCA está deshabilitada (falta certificado / punto de venta habilitado)' using errcode = '42501';
  end if;
  if p_ambiente = 'homologacion' and not coalesce((v_cfg->>'homologacion_habilitada')::boolean, false) then
    raise exception 'La homologación de ARCA no está habilitada (falta el certificado de prueba)' using errcode = '42501';
  end if;
  select * into v from public.fact_prefacturas where id = p_prefactura_id for update;
  if v.id is null then raise exception 'Prefactura inexistente'; end if;
  if v.estado <> 'aprobada_emitir' or v.huella is distinct from v.huella_aprobada then
    raise exception 'Sólo se emite una prefactura aprobada y sin cambios desde la aprobación';
  end if;
  if v.version <> p_version then raise exception 'La prefactura cambió; recargá' using errcode = '40001'; end if;
  -- Cada ambiente tiene su propio punto de venta y no hay valor por defecto:
  -- ni el punto de la prefactura ni la clave vieja punto_venta se usan para emitir por API.
  v_pv := nullif(v_cfg->>v_clave_pv, '')::int;
  if v_pv is null or v_pv <= 0 then raise exception 'Falta configurar el punto de venta Web Service (fact_config.emision.%)', v_clave_pv; end if;
  -- Un punto usado por Comprobantes en línea o cargado a mano no es un punto Web Service.
  if p_ambiente = 'produccion' and exists (select 1 from public.fact_comprobantes c
      where c.ambiente = 'produccion' and c.punto_venta = v_pv and c.origen in ('importacion_arca', 'carga_manual')) then
    raise exception 'El punto de venta % ya se usa fuera de la API (Comprobantes en línea o carga manual): no se emite por Web Service', v_pv;
  end if;
  v_cuit := nullif(regexp_replace(coalesce(case when p_ambiente = 'homologacion' then nullif(v_cfg->>'cuit_emisor_homo', '') end, v_cfg->>'cuit_emisor', ''), '\D', '', 'g'), '');
  if v_cuit is null then raise exception 'Falta configurar el CUIT emisor (fact_config.emision.cuit_emisor)'; end if;
  if exists (select 1 from public.fact_comprobantes c where c.prefactura_id = v.id and c.ambiente = p_ambiente and c.tipo in (1, 6, 201)) then
    raise exception 'La prefactura ya tiene un comprobante registrado (emisión manual o importada): no se emite otro';
  end if;
  v_clave := v.id::text || ':' || v.huella_aprobada || ':' || p_ambiente;
  select * into v_ex from public.fact_emisiones where clave_idempotencia = v_clave;
  if v_ex.id is not null then
    return jsonb_build_object('id', v_ex.id, 'estado', v_ex.estado, 'existente', true);
  end if;
  select * into v_ex from public.fact_emisiones e where e.prefactura_id = v.id and e.ambiente = p_ambiente and e.estado in ('preparada', 'enviando', 'incierta', 'autorizada');
  if v_ex.id is not null then
    return jsonb_build_object('id', v_ex.id, 'estado', v_ex.estado, 'existente', true);
  end if;
  insert into public.fact_emisiones (prefactura_id, clave_idempotencia, ambiente, cuit_emisor, tipo, punto_venta, estado, solicitud, creado_por, aprobado_por)
  values (v.id, v_clave, p_ambiente, v_cuit, v.tipo_comprobante, v_pv, 'preparada',
    jsonb_build_object('cuit_receptor', v.cuit_receptor, 'periodo_desde', v.periodo_desde, 'periodo_hasta', v.periodo_hasta_excl - 1,
      'vto_pago', v.fecha_vencimiento, 'neto_c', v.neto_c, 'iva_c', v.iva_c, 'total_c', v.total_c, 'lineas', v.lineas,
      'texto', v.texto_factura, 'cliente_id', v.cliente_id, 'huella', v.huella_aprobada),
    v_actor, v.aprobada_por)
  returning id into v_id;
  perform public.fact_registrar('prefactura', v.id, 'emision_preparada', jsonb_build_object('emision_id', v_id, 'ambiente', p_ambiente), v_actor);
  return jsonb_build_object('id', v_id, 'estado', 'preparada', 'existente', false);
end $fn$;

revoke all on function public.fact_emision_preparar(uuid, integer, text) from public, anon;
grant execute on function public.fact_emision_preparar(uuid, integer, text) to authenticated, service_role;
commit;
