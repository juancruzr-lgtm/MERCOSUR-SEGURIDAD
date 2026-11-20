-- Rollback 20261220110000_facturacion_cobro_idempotente: vuelve fact_cobro_registrar a la versión anterior
-- (sin id del cliente ni control de duplicados). Los cobros ya cargados no cambian.
create or replace function public.fact_cobro_registrar(p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_mov public.fact_movimientos_bancarios; v_medio text := p_datos->>'medio';
begin
  perform public.fact_modulo_exigir('cobranzas');
  if nullif(p_datos->>'movimiento_id', '') is not null then
    select * into v_mov from public.fact_movimientos_bancarios where id = (p_datos->>'movimiento_id')::uuid for update;
    if v_mov.id is null then raise exception 'Movimiento inexistente'; end if;
    if v_mov.clasificacion <> 'cobranza_posible' then raise exception 'El movimiento no está clasificado como cobranza (%): no se registra como cobro', v_mov.clasificacion; end if;
    if v_mov.importe_c <> (p_datos->>'importe_c')::bigint then raise exception 'El importe del cobro debe coincidir con el del movimiento'; end if;
  end if;
  insert into public.fact_cobros (cliente_id, fecha, importe_c, medio, referencia, movimiento_id, es_anticipo, cheque_numero, cheque_banco,
    cheque_fecha_pago, cheque_estado, documento_id, notas, creado_por)
  values ((p_datos->>'cliente_id')::uuid, (p_datos->>'fecha')::date, (p_datos->>'importe_c')::bigint, v_medio, p_datos->>'referencia',
    v_mov.id, coalesce((p_datos->>'es_anticipo')::boolean, false), p_datos->>'cheque_numero', p_datos->>'cheque_banco',
    nullif(p_datos->>'cheque_fecha_pago', '')::date, case when v_medio in ('cheque', 'echeq') then coalesce(p_datos->>'cheque_estado', 'en_cartera') end,
    nullif(p_datos->>'documento_id', '')::uuid, p_datos->>'notas', v_actor)
  returning id into v_id;
  perform public.fact_registrar('cobro', v_id, 'alta', p_datos, v_actor);
  return v_id;
end $fn$;
revoke all on function public.fact_cobro_registrar(jsonb) from public, anon;
grant execute on function public.fact_cobro_registrar(jsonb) to authenticated;
