-- ============================================================================
-- Facturación: el comprobante guarda las fechas que efectivamente recibió ARCA
-- ============================================================================
-- Problema (prueba en homologación del 10/11/2026): la prefactura de PNC tenía
-- vencimiento de pago 03/11/2026. Al emitir el 10/11, el servidor no puede
-- informarle a ARCA una fecha anterior a la del comprobante y manda la del día
-- (lib/facturacion/vto-arca.ts). Pero el comprobante guardaba la de la
-- prefactura: el PDF imprimía "Fecha de Vto. para el pago: 03/11/2026" (anterior
-- a la factura y distinta de la registrada en ARCA), y las cuentas corrientes la
-- tomaban como vencida.
--
-- Arreglo: al dar de alta el comprobante autorizado se usan las fechas del pedido
-- que se mandó a ARCA. fact_emision_iniciar_envio lo guarda en solicitud.arca:
-- vtoPago, servicioDesde y servicioHasta. Si no están (emisiones anteriores o
-- pedidos sin esos datos), se usan las de la prefactura, como antes.
--
-- Sólo cambia esta función: misma firma, mismo dueño y mismos permisos (CREATE OR
-- REPLACE los conserva). No toca datos. Los 2 comprobantes de homologación del
-- 10/11 quedan como están.
--
-- Rollback: supabase/rollback/20261210100000_facturacion_vto_enviado_a_arca_rollback.sql
-- ============================================================================

begin;

-- Alta del comprobante autorizado (común a resultado directo y consulta).
create or replace function public.fact_emision_autorizar_interno(e public.fact_emisiones, p_cae text, p_cae_vto date, p_fecha date, p_respuesta jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_comp uuid; s jsonb := e.solicitud; v_arca jsonb := coalesce(e.solicitud->'arca', '{}'::jsonb); v_pref public.fact_prefacturas; v_req_portal boolean;
begin
  insert into public.fact_comprobantes (ambiente, cuit_emisor, tipo, punto_venta, numero, fecha_emision, cliente_id, doc_tipo_receptor, doc_nro_receptor,
    concepto, servicio_desde, servicio_hasta, vto_pago, neto_c, iva_c, total_c, cae, cae_vto, origen, prefactura_id, asociado_id, alcance_nota, motivo,
    respuesta_arca, creado_por)
  values (e.ambiente, e.cuit_emisor, e.tipo, e.punto_venta, e.numero, p_fecha, nullif(s->>'cliente_id', '')::uuid, 80, s->>'cuit_receptor',
    2,
    -- Las fechas que recibió ARCA (solicitud.arca); si faltan, las de la prefactura.
    coalesce(nullif(v_arca->>'servicioDesde', '')::date, nullif(s->>'periodo_desde', '')::date),
    coalesce(nullif(v_arca->>'servicioHasta', '')::date, nullif(s->>'periodo_hasta', '')::date),
    coalesce(nullif(v_arca->>'vtoPago', '')::date, nullif(s->>'vto_pago', '')::date),
    (s->>'neto_c')::bigint, (s->>'iva_c')::bigint, (s->>'total_c')::bigint, p_cae, p_cae_vto, 'emision_app',
    case when e.tipo in (1, 6, 201) then e.prefactura_id end, e.comprobante_asociado_id, e.alcance_nota, e.motivo, p_respuesta, e.creado_por)
  returning id into v_comp;
  update public.fact_emisiones set estado = 'autorizada', respuesta = p_respuesta, comprobante_id = v_comp, updated_at = now() where id = e.id;
  if e.prefactura_id is not null and e.ambiente = 'produccion' then
    select * into v_pref from public.fact_prefacturas where id = e.prefactura_id for update;
    select coalesce(k.requiere_portal, false) into v_req_portal from public.fact_contratos k where k.id = v_pref.contrato_id;
    update public.fact_prefacturas set estado = 'emitida',
      estado_portal = case when coalesce(v_req_portal, false) then 'pendiente' else estado_portal end
    where id = e.prefactura_id;
    if v_pref.oc_id is not null then
      insert into public.fact_oc_consumos (oc_id, prefactura_id, neto_c, total_c, horas)
      values (v_pref.oc_id, v_pref.id, v_pref.neto_c, v_pref.total_c, coalesce(v_pref.minutos_aprobados, 0) / 60.0)
      on conflict (oc_id, prefactura_id) where anulado_at is null do nothing;
    end if;
  end if;
  insert into public.fact_historial (entidad, entidad_id, accion, datos, por)
  values ('comprobante', v_comp, 'autorizado', jsonb_build_object('emision_id', e.id, 'cae', p_cae, 'ambiente', e.ambiente), e.creado_por);
  return v_comp;
end $fn$;

-- Por las dudas (CREATE OR REPLACE ya conserva los permisos): sólo la usan otras funciones SECURITY DEFINER.
revoke all on function public.fact_emision_autorizar_interno(public.fact_emisiones, text, date, date, jsonb) from public, anon, authenticated;

commit;
