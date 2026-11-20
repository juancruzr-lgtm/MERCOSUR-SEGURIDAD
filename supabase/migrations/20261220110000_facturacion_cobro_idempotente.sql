-- Cobranzas: el alta de un cobro pasa a ser idempotente.
-- 1) La pantalla manda un id generado en el cliente (p_datos.id): si se reintenta o se hace doble clic, se
--    devuelve el mismo cobro en vez de crear otro.
-- 2) Además se rechaza un cobro idéntico (mismo cliente, fecha, importe, medio, referencia y n° de cheque) cargado por la
--    misma persona en los últimos 2 minutos: cubre pantallas viejas que todavía no mandan id.
-- Mismo cuerpo que la versión vigente en todo lo demás (movimiento bancario, cheques, historial).
create or replace function public.fact_cobro_registrar(p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_mov public.fact_movimientos_bancarios; v_medio text := p_datos->>'medio';
  v_pedido uuid := nullif(p_datos->>'id', '')::uuid; v_dup uuid;
begin
  perform public.fact_modulo_exigir('cobranzas');
  if v_pedido is not null then
    select id into v_dup from public.fact_cobros where id = v_pedido;
    if v_dup is not null then return v_dup; end if;
  end if;
  select id into v_dup from public.fact_cobros
   where creado_por = v_actor and anulado_at is null and created_at > now() - interval '2 minutes'
     and cliente_id = (p_datos->>'cliente_id')::uuid and fecha = (p_datos->>'fecha')::date
     and importe_c = (p_datos->>'importe_c')::bigint and medio = v_medio
     and coalesce(referencia, '') = coalesce(p_datos->>'referencia', '')
     and coalesce(cheque_numero, '') = coalesce(p_datos->>'cheque_numero', '')
   limit 1;
  if v_dup is not null then
    raise exception 'Ese cobro ya se registró hace instantes (mismo cliente, fecha, importe y referencia). Revisá la lista antes de cargarlo de nuevo.';
  end if;
  if nullif(p_datos->>'movimiento_id', '') is not null then
    select * into v_mov from public.fact_movimientos_bancarios where id = (p_datos->>'movimiento_id')::uuid for update;
    if v_mov.id is null then raise exception 'Movimiento inexistente'; end if;
    if v_mov.clasificacion <> 'cobranza_posible' then raise exception 'El movimiento no está clasificado como cobranza (%): no se registra como cobro', v_mov.clasificacion; end if;
    if v_mov.importe_c <> (p_datos->>'importe_c')::bigint then raise exception 'El importe del cobro debe coincidir con el del movimiento'; end if;
  end if;
  insert into public.fact_cobros (id, cliente_id, fecha, importe_c, medio, referencia, movimiento_id, es_anticipo, cheque_numero, cheque_banco,
    cheque_fecha_pago, cheque_estado, documento_id, notas, creado_por)
  values (coalesce(v_pedido, gen_random_uuid()), (p_datos->>'cliente_id')::uuid, (p_datos->>'fecha')::date, (p_datos->>'importe_c')::bigint, v_medio, p_datos->>'referencia',
    v_mov.id, coalesce((p_datos->>'es_anticipo')::boolean, false), p_datos->>'cheque_numero', p_datos->>'cheque_banco',
    nullif(p_datos->>'cheque_fecha_pago', '')::date, case when v_medio in ('cheque', 'echeq') then coalesce(p_datos->>'cheque_estado', 'en_cartera') end,
    nullif(p_datos->>'documento_id', '')::uuid, p_datos->>'notas', v_actor)
  on conflict (id) do nothing
  returning id into v_id;
  if v_id is null then return v_pedido; end if; -- otro pedido simultáneo con el mismo id ganó la carrera
  perform public.fact_registrar('cobro', v_id, 'alta', p_datos, v_actor);
  return v_id;
end $fn$;

revoke all on function public.fact_cobro_registrar(jsonb) from public, anon;
grant execute on function public.fact_cobro_registrar(jsonb) to authenticated;
