-- Grupos de factura (PR #362). Decide qué objetivos de un contrato van juntos en un comprobante,
-- independiente de las tarifas (que siguen siendo por contrato, con precio propio opcional por objetivo).
--  · fact_contrato_objetivos.grupo_factura: NULL = como hasta ahora (lo decide fact_contratos.agrupacion).
--    Mismo texto en varios objetivos del contrato = una sola factura para ellos.
--  · fact_prefacturas.objetivos_incluidos: qué objetivos cubre cada prefactura. Impide que un objetivo
--    quede en dos prefacturas del mismo período al reagrupar.
-- No cambia ninguna agrupación existente (todo arranca en NULL), ni horas, tarifas, prefacturas ni liquidación.
begin;

alter table public.fact_contrato_objetivos add column if not exists grupo_factura text;
alter table public.fact_contrato_objetivos drop constraint if exists fact_contrato_objetivos_grupo_factura_check;
alter table public.fact_contrato_objetivos add constraint fact_contrato_objetivos_grupo_factura_check
  check (grupo_factura is null or (grupo_factura = btrim(grupo_factura) and length(grupo_factura) between 1 and 60));

alter table public.fact_prefacturas add column if not exists objetivos_incluidos uuid[];

create or replace function public.fact_contrato_objetivo_grupo(p_id uuid, p_grupo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_contrato uuid; v_antes text; v_grupo text := nullif(btrim(coalesce(p_grupo, '')), '');
begin
  select contrato_id, grupo_factura into v_contrato, v_antes from public.fact_contrato_objetivos where id = p_id and anulado_at is null for update;
  if v_contrato is null then raise exception 'El objetivo no está vinculado al contrato'; end if;
  if v_antes is not distinct from v_grupo then return; end if;
  update public.fact_contrato_objetivos set grupo_factura = v_grupo where id = p_id;
  perform public.fact_registrar('contrato', v_contrato, 'grupo_factura',
    jsonb_build_object('vinculo_id', p_id, 'antes', v_antes, 'ahora', v_grupo), v_actor);
end $fn$;

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
      texto_factura, cuit_receptor, tipo_comprobante, punto_venta, fecha_vencimiento, oc_id, anticipo_prefactura_id, objetivos_incluidos, creado_por, actualizado_por)
    values ((p_datos->>'cliente_id')::uuid, nullif(p_datos->>'contrato_id', '')::uuid, p_datos->>'agrupacion_clave',
      nullif(p_datos->>'objetivo_id', '')::uuid, p_datos->>'periodo_mes', (p_datos->>'periodo_desde')::date, (p_datos->>'periodo_hasta_excl')::date,
      v_estado, coalesce(p_datos->>'estado_entrega', 'pendiente'), coalesce(p_datos->>'estado_portal', 'no_requiere'),
      coalesce(nullif(p_datos->>'responsable_id', '')::uuid, v_actor), p_datos->>'proxima_accion', nullif(p_datos->>'proxima_accion_fecha', '')::date,
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_datos->'horas_aprobacion_ids') x), '{}'),
      nullif(p_datos->>'minutos_programados', '')::int, nullif(p_datos->>'minutos_cubiertos', '')::int, nullif(p_datos->>'minutos_aprobados', '')::int, nullif(p_datos->>'minutos_descubiertos', '')::int,
      coalesce(p_datos->'lineas', '[]'::jsonb), nullif(p_datos->>'neto_c', '')::bigint, nullif(p_datos->>'iva_c', '')::bigint, nullif(p_datos->>'total_c', '')::bigint,
      coalesce(p_datos->'requisitos', '[]'::jsonb), coalesce(p_datos->'avisos', '[]'::jsonb),
      p_datos->>'texto_factura', p_datos->>'cuit_receptor', nullif(p_datos->>'tipo_comprobante', '')::int, nullif(p_datos->>'punto_venta', '')::int,
      nullif(p_datos->>'fecha_vencimiento', '')::date, nullif(p_datos->>'oc_id', '')::uuid, nullif(p_datos->>'anticipo_prefactura_id', '')::uuid,
      (select array_agg(x::uuid) from jsonb_array_elements_text(p_datos->'objetivos_incluidos') x), v_actor, v_actor)
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
      objetivos_incluidos = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_datos->'objetivos_incluidos') x), objetivos_incluidos),
      version = version + 1, actualizado_por = v_actor
    where id = p_id and version = coalesce(p_version, version) and estado not in ('emitida', 'descartada')
    returning id into v_id;
    if v_id is null then raise exception 'La prefactura cambió, está emitida o descartada; recargá' using errcode = '40001'; end if;
    perform public.fact_registrar('prefactura', v_id, 'recalculo', p_datos - 'lineas', v_actor);
  end if;
  return v_id;
end $fn$;

revoke all on function public.fact_contrato_objetivo_grupo(uuid, text) from public, anon;
grant execute on function public.fact_contrato_objetivo_grupo(uuid, text) to authenticated;
revoke all on function public.fact_prefactura_guardar(uuid, jsonb, integer) from public, anon;
grant execute on function public.fact_prefactura_guardar(uuid, jsonb, integer) to authenticated;

commit;
