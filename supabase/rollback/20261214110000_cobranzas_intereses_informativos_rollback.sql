-- Rollback de 20261214110000_cobranzas_intereses_informativos (correr APARTE, nunca junto a la migración).
-- Quita la tasa por contrato, la tasa general y la marca "no cobrar"; fact_contrato_condiciones_guardar vuelve a
-- su versión anterior (la de 20261201150000). Lo cobrado, los saldos y los comprobantes no se tocan.
drop function if exists public.fact_interes_no_cobrar(uuid, boolean, text);
drop function if exists public.fact_intereses_config_guardar(jsonb);

create or replace function public.fact_contrato_condiciones_guardar(p_contrato_id uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); k public.fact_contratos;
begin
  select * into k from public.fact_contratos where id = p_contrato_id for update;
  if k.id is null then raise exception 'Contrato inexistente'; end if;
  update public.fact_contratos set
    dias_vencimiento = case when p_datos ? 'dias_vencimiento' then nullif(p_datos->>'dias_vencimiento', '')::int else dias_vencimiento end,
    pago_evento = case when p_datos ? 'pago_evento' then nullif(p_datos->>'pago_evento', '') else pago_evento end,
    pago_dia_mes = case when p_datos ? 'pago_dia_mes' then nullif(p_datos->>'pago_dia_mes', '')::int else pago_dia_mes end,
    mora_tasa = case when p_datos ? 'mora_tasa' then nullif(p_datos->>'mora_tasa', '')::numeric else mora_tasa end,
    mora_tasa_periodo = case when p_datos ? 'mora_tasa_periodo' then nullif(p_datos->>'mora_tasa_periodo', '') else mora_tasa_periodo end,
    mora_metodo = case when p_datos ? 'mora_metodo' then nullif(p_datos->>'mora_metodo', '') else mora_metodo end,
    mora_gracia_dias = case when p_datos ? 'mora_gracia_dias' then coalesce(nullif(p_datos->>'mora_gracia_dias', '')::int, 0) else mora_gracia_dias end,
    mora_condiciones = case when p_datos ? 'mora_condiciones' then nullif(trim(p_datos->>'mora_condiciones'), '') else mora_condiciones end,
    condiciones_documento_id = case when p_datos ? 'condiciones_documento_id' then nullif(p_datos->>'condiciones_documento_id', '')::uuid else condiciones_documento_id end,
    version = version + 1, actualizado_por = v_actor, updated_at = now()
  where id = p_contrato_id;
  perform public.fact_registrar('contrato', p_contrato_id, 'condiciones_comerciales', jsonb_build_object('nuevas', p_datos,
    'anteriores', jsonb_build_object('dias_vencimiento', k.dias_vencimiento, 'pago_evento', k.pago_evento, 'pago_dia_mes', k.pago_dia_mes,
      'mora_tasa', k.mora_tasa, 'mora_tasa_periodo', k.mora_tasa_periodo, 'mora_metodo', k.mora_metodo, 'mora_gracia_dias', k.mora_gracia_dias,
      'mora_condiciones', k.mora_condiciones)), v_actor);
end $fn$;
revoke all on function public.fact_contrato_condiciones_guardar(uuid, jsonb) from public, anon;
grant execute on function public.fact_contrato_condiciones_guardar(uuid, jsonb) to authenticated, service_role;

alter table public.fact_comprobante_seguimiento drop constraint if exists fact_comprobante_seguimiento_interes_motivo;
alter table public.fact_comprobante_seguimiento
  drop column if exists interes_no_cobrar_at, drop column if exists interes_no_cobrar_por,
  drop column if exists interes_no_cobrar_motivo, drop column if exists interes_no_cobrar;
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_fija_con_tasa;
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_tasa_factor_check;
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_tasa_tipo_check;
alter table public.fact_contratos drop column if exists mora_tasa_factor, drop column if exists mora_tasa_tipo;
delete from public.fact_config where clave = 'intereses';
