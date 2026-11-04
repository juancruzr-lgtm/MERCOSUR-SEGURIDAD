-- Rollback de 20261202120000_facturacion_grupos_factura. Correr APARTE, nunca junto a la migración.
-- Vuelve fact_prefactura_guardar a la versión de 20261201120000 y quita las dos columnas.
begin;

drop function if exists public.fact_contrato_objetivo_grupo(uuid, text);

create or replace function public.fact_prefactura_guardar(p_id uuid, p_datos jsonb, p_version integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_estado text := coalesce(p_datos->>'estado', 'en_preparacion');
begin
  if v_estado not in ('en_preparacion', 'esperando_requisitos', 'lista_revision') then
    raise exception 'Estado no permitido al guardar: %', v_estado;
  end if;
  if p_id is null then
    insert into public.fact_prefacturas (cliente_id, contrato_id, agrupacion_clave, objetivo_id, periodo_mes, periodo_desde, periodo_hasta_excl,
      estado, estado_entrega, estado_portal, responsable_id, proxima_accion, proxima_accion_fecha, horas_aprobacion_ids,
      minutos_programados, minutos_cubiertos, minutos_aprobados, minutos_descubiertos, lineas, neto_c, iva_c, total_c, requisitos, avisos,
      texto_factura, cuit_receptor, tipo_comprobante, punto_venta, fecha_vencimiento, oc_id, anticipo_prefactura_id, creado_por, actualizado_por)
    values ((p_datos->>'cliente_id')::uuid, nullif(p_datos->>'contrato_id', '')::uuid, p_datos->>'agrupacion_clave',
      nullif(p_datos->>'objetivo_id', '')::uuid, p_datos->>'periodo_mes', (p_datos->>'periodo_desde')::date, (p_datos->>'periodo_hasta_excl')::date,
      v_estado, coalesce(p_datos->>'estado_entrega', 'pendiente'), coalesce(p_datos->>'estado_portal', 'no_requiere'),
      coalesce(nullif(p_datos->>'responsable_id', '')::uuid, v_actor), p_datos->>'proxima_accion', nullif(p_datos->>'proxima_accion_fecha', '')::date,
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_datos->'horas_aprobacion_ids') x), '{}'),
      nullif(p_datos->>'minutos_programados', '')::int, nullif(p_datos->>'minutos_cubiertos', '')::int, nullif(p_datos->>'minutos_aprobados', '')::int, nullif(p_datos->>'minutos_descubiertos', '')::int,
      coalesce(p_datos->'lineas', '[]'::jsonb), nullif(p_datos->>'neto_c', '')::bigint, nullif(p_datos->>'iva_c', '')::bigint, nullif(p_datos->>'total_c', '')::bigint,
      coalesce(p_datos->'requisitos', '[]'::jsonb), coalesce(p_datos->'avisos', '[]'::jsonb),
      p_datos->>'texto_factura', p_datos->>'cuit_receptor', nullif(p_datos->>'tipo_comprobante', '')::int, nullif(p_datos->>'punto_venta', '')::int,
      nullif(p_datos->>'fecha_vencimiento', '')::date, nullif(p_datos->>'oc_id', '')::uuid, nullif(p_datos->>'anticipo_prefactura_id', '')::uuid, v_actor, v_actor)
    returning id into v_id;
    perform public.fact_registrar('prefactura', v_id, 'alta', p_datos - 'lineas', v_actor);
  else
    update public.fact_prefacturas set
      estado = case when estado = 'aprobada_emitir' then estado else v_estado end,
      responsable_id = coalesce(nullif(p_datos->>'responsable_id', '')::uuid, responsable_id),
      proxima_accion = p_datos->>'proxima_accion', proxima_accion_fecha = nullif(p_datos->>'proxima_accion_fecha', '')::date,
      horas_aprobacion_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_datos->'horas_aprobacion_ids') x), horas_aprobacion_ids),
      minutos_programados = nullif(p_datos->>'minutos_programados', '')::int, minutos_cubiertos = nullif(p_datos->>'minutos_cubiertos', '')::int, minutos_aprobados = nullif(p_datos->>'minutos_aprobados', '')::int,
      minutos_descubiertos = nullif(p_datos->>'minutos_descubiertos', '')::int,
      lineas = coalesce(p_datos->'lineas', lineas), neto_c = nullif(p_datos->>'neto_c', '')::bigint, iva_c = nullif(p_datos->>'iva_c', '')::bigint,
      total_c = nullif(p_datos->>'total_c', '')::bigint, requisitos = coalesce(p_datos->'requisitos', requisitos), avisos = coalesce(p_datos->'avisos', avisos),
      texto_factura = coalesce(p_datos->>'texto_factura', texto_factura), cuit_receptor = p_datos->>'cuit_receptor',
      tipo_comprobante = nullif(p_datos->>'tipo_comprobante', '')::int, punto_venta = nullif(p_datos->>'punto_venta', '')::int,
      fecha_vencimiento = nullif(p_datos->>'fecha_vencimiento', '')::date, oc_id = nullif(p_datos->>'oc_id', '')::uuid,
      anticipo_prefactura_id = nullif(p_datos->>'anticipo_prefactura_id', '')::uuid,
      version = version + 1, actualizado_por = v_actor
    where id = p_id and version = coalesce(p_version, version) and estado not in ('emitida', 'descartada')
    returning id into v_id;
    if v_id is null then raise exception 'La prefactura cambió, está emitida o descartada; recargá' using errcode = '40001'; end if;
    perform public.fact_registrar('prefactura', v_id, 'recalculo', p_datos - 'lineas', v_actor);
  end if;
  return v_id;
end $fn$;

revoke all on function public.fact_prefactura_guardar(uuid, jsonb, integer) from public, anon;
grant execute on function public.fact_prefactura_guardar(uuid, jsonb, integer) to authenticated;

alter table public.fact_prefacturas drop column if exists objetivos_incluidos;
alter table public.fact_contrato_objetivos drop constraint if exists fact_contrato_objetivos_grupo_factura_check;
alter table public.fact_contrato_objetivos drop column if exists grupo_factura;

commit;
