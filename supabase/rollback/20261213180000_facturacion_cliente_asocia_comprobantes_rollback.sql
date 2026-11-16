-- Rollback de 20261213180000_facturacion_cliente_asocia_comprobantes.sql
-- Vuelve fact_cliente_guardar a su versión de 20261201120000 (sin asociar comprobantes). Las asociaciones
-- ya hechas se conservan (fact_historial, accion = 'asociado_cliente'): una asociación fijada no se deshace.
begin;
create or replace function public.fact_cliente_guardar(p_id uuid, p_datos jsonb, p_version integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_cuit text := nullif(regexp_replace(coalesce(p_datos->>'cuit', ''), '\D', '', 'g'), '');
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
  return v_id;
end $fn$;
commit;
