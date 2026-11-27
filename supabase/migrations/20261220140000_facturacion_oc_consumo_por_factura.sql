-- Licitaciones / OC: descontar del presupuesto de una orden de compra una factura ya emitida (por ejemplo, hecha
-- fuera de la app). Hasta ahora el consumo sólo nacía de una prefactura emitida o conciliada. Clientes como INTA
-- dan un presupuesto en pesos por mes que se va descontando con cada factura.
-- El consumo no se borra: se anula con motivo y queda en el historial. Identidad y permiso: facturacion_gate().

alter table public.fact_oc_consumos alter column prefactura_id drop not null;
alter table public.fact_oc_consumos add column if not exists comprobante_id uuid references public.fact_comprobantes(id);
alter table public.fact_oc_consumos add column if not exists anulado_motivo text;
alter table public.fact_oc_consumos drop constraint if exists fact_oc_consumos_origen;
alter table public.fact_oc_consumos add constraint fact_oc_consumos_origen check (prefactura_id is not null or comprobante_id is not null);
create unique index if not exists ux_fact_oc_consumo_comprobante on public.fact_oc_consumos (oc_id, comprobante_id)
  where anulado_at is null and comprobante_id is not null;

-- Descontar una factura del presupuesto de la OC. Idempotente: si ya está descontada, devuelve el mismo consumo.
create or replace function public.fact_oc_consumo_comprobante(p_oc_id uuid, p_comprobante_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); o public.fact_ordenes_compra; k public.fact_comprobantes; v_id uuid;
begin
  select * into o from public.fact_ordenes_compra where id = p_oc_id for update;
  if o.id is null then raise exception 'Orden de compra inexistente'; end if;
  select * into k from public.fact_comprobantes where id = p_comprobante_id;
  if k.id is null or k.ambiente <> 'produccion' then raise exception 'Factura inexistente'; end if;
  if k.tipo in (3, 8, 13, 53, 203, 208, 213) then raise exception 'Una nota de crédito no se descuenta del presupuesto'; end if;
  if k.cliente_id is distinct from o.cliente_id then raise exception 'La factura y la orden de compra son de clientes distintos'; end if;
  select id into v_id from public.fact_oc_consumos where oc_id = p_oc_id and comprobante_id = p_comprobante_id and anulado_at is null;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.fact_oc_consumos c join public.fact_comprobantes x on x.prefactura_id = c.prefactura_id
             where c.oc_id = p_oc_id and x.id = p_comprobante_id and c.anulado_at is null) then
    raise exception 'Esa factura ya está descontada por su prefactura';
  end if;
  insert into public.fact_oc_consumos (oc_id, prefactura_id, comprobante_id, neto_c, total_c, horas)
  values (p_oc_id, k.prefactura_id, p_comprobante_id, k.neto_c + coalesce(k.no_gravado_c, 0) + coalesce(k.exento_c, 0), k.total_c, 0)
  returning id into v_id;
  perform public.fact_registrar('orden_compra', p_oc_id, 'consumo_factura',
    jsonb_build_object('consumo_id', v_id, 'comprobante_id', p_comprobante_id, 'total_c', k.total_c), v_actor);
  return v_id;
end $fn$;

-- Anular un descuento hecho por error (queda el registro).
create or replace function public.fact_oc_consumo_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); c public.fact_oc_consumos;
begin
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Indicá el motivo'; end if;
  select * into c from public.fact_oc_consumos where id = p_id for update;
  if c.id is null then raise exception 'Consumo inexistente'; end if;
  if c.anulado_at is not null then return; end if;
  update public.fact_oc_consumos set anulado_at = now(), anulado_motivo = trim(p_motivo) where id = p_id;
  perform public.fact_registrar('orden_compra', c.oc_id, 'consumo_anulado', jsonb_build_object('consumo_id', p_id, 'motivo', trim(p_motivo)), v_actor);
end $fn$;

revoke all on function public.fact_oc_consumo_comprobante(uuid, uuid) from public, anon;
revoke all on function public.fact_oc_consumo_anular(uuid, text) from public, anon;
grant execute on function public.fact_oc_consumo_comprobante(uuid, uuid) to authenticated;
grant execute on function public.fact_oc_consumo_anular(uuid, text) to authenticated;
