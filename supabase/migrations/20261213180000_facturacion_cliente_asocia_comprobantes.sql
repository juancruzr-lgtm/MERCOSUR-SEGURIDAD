-- Facturación: al dar de alta (o corregir el CUIT de) un cliente, se le asocian sus comprobantes
--
-- CAUSA
-- Los comprobantes importados de ARCA de un receptor que todavía no era cliente de la app quedan sin
-- cliente: no aparecen en su cuenta corriente y no se les puede registrar el cobro. Dar de alta el
-- cliente no los asociaba; había que hacerlo uno por uno desde Comprobantes → Asociar.
--
-- CAMBIO
--   · fact_cliente_guardar: igual que antes y, si el cliente tiene CUIT, asocia los comprobantes de
--     producción de ese CUIT que no tienen cliente (el trigger fact_comprobante_inmutable permite completar
--     una asociación vacía, nunca cambiar una fijada). Cada asociación queda en fact_historial.
--
-- Reversible: supabase/rollback/20261213180000_facturacion_cliente_asocia_comprobantes_rollback.sql

create or replace function public.fact_cliente_guardar(p_id uuid, p_datos jsonb, p_version integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_cuit text := nullif(regexp_replace(coalesce(p_datos->>'cuit', ''), '\D', '', 'g'), '');
  v_comp record;
begin
  if v_cuit is not null and not public.fact_cuit_valido(v_cuit) then raise exception 'CUIT inválido: %', p_datos->>'cuit'; end if;
  if p_id is null then
    insert into public.fact_clientes (cuit, razon_social, condicion_iva, tipo_comprobante, domicilio, notas, creado_por, actualizado_por)
    values (v_cuit, trim(p_datos->>'razon_social'), nullif(p_datos->>'condicion_iva', ''),
            nullif(p_datos->>'tipo_comprobante', '')::int, nullif(trim(p_datos->>'domicilio'), ''), p_datos->>'notas', v_actor, v_actor)
    returning id into v_id;
    perform public.fact_registrar('cliente', v_id, 'alta', p_datos, v_actor);
  else
    update public.fact_clientes set
      cuit = v_cuit, razon_social = trim(p_datos->>'razon_social'),
      condicion_iva = coalesce(nullif(p_datos->>'condicion_iva', ''), condicion_iva),
      tipo_comprobante = nullif(p_datos->>'tipo_comprobante', '')::int,
      domicilio = case when p_datos ? 'domicilio' then nullif(trim(p_datos->>'domicilio'), '') else domicilio end,
      notas = p_datos->>'notas', activo = coalesce((p_datos->>'activo')::boolean, activo),
      version = version + 1, actualizado_por = v_actor, updated_at = now()
    where id = p_id and version = coalesce(p_version, version)
    returning id into v_id;
    if v_id is null then raise exception 'El cliente cambió mientras lo editabas; recargá' using errcode = '40001'; end if;
    perform public.fact_registrar('cliente', v_id, 'edicion', p_datos, v_actor);
  end if;

  -- Comprobantes ya emitidos a este CUIT que todavía no tenían cliente: pasan a su cuenta corriente.
  if v_cuit is not null then
    for v_comp in
      select id from public.fact_comprobantes
       where cliente_id is null and ambiente = 'produccion' and regexp_replace(coalesce(doc_nro_receptor, ''), '\D', '', 'g') = v_cuit
       for update
    loop
      update public.fact_comprobantes set cliente_id = v_id where id = v_comp.id;
      perform public.fact_registrar('comprobante', v_comp.id, 'asociado_cliente', jsonb_build_object('cliente_id', v_id, 'por_cuit', v_cuit), v_actor);
    end loop;
  end if;
  return v_id;
end $fn$;
