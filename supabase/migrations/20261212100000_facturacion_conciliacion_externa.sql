-- 20261212100000 · Conciliación de facturas emitidas FUERA de la app con sus prefacturas.
--
-- Octubre 2026 se facturó por Comprobantes en línea (punto de venta 1). ARCA no deja leer esas
-- facturas por el web service de facturación (11002 para los puntos que no son Web Service), así que
-- la fuente es el archivo de "Mis Comprobantes – Emitidos" importado (fact_comprobantes, origen
-- importacion_arca). Este cambio:
--   · fact_prefacturas.conciliacion: con qué comprobante real se concilió la prefactura, la diferencia
--     con lo calculado (importe y horas) y su estado (sin_diferencia / pendiente / explicada / resuelta).
--   · fact_prefactura_conciliar: vincula UN comprobante importado con UNA prefactura todavía no emitida
--     (también si estaba bloqueada por requisitos, p. ej. la OC de ACA) y la deja EMITIDA, aunque el
--     importe difiera; la prefactura tiene que tener importe calculado (si no, no hay con qué comparar).
--     Automáticamente sólo se vinculan las exactas; con diferencia, a mano y con motivo.
--     NO cambia horas ni importes: ni de la prefactura (lo calculado queda como
--     referencia) ni del comprobante (lo facturado). Conserva CAE, número, fecha, punto de venta e historial.
--   · fact_conciliacion_diferencia: deja una diferencia como pendiente, explicada o resuelta, con motivo.
--   · fact_excepcion_duplicado: registro de la autorización EXPRESA de Gerencia para emitir pese a un
--     posible duplicado (la ruta de emisión la exige antes de pedir CAE).
-- Duplicados: ya existen el único (ambiente, cuit_emisor, tipo, punto_venta, numero) de comprobantes,
-- una factura por prefactura (ux_fact_comprobante_prefactura) y una prefactura viva por prestación
-- (ux_fact_prefactura_prestacion). Este archivo no los toca.
-- Rollback: supabase/rollback/20261212100000_facturacion_conciliacion_externa_rollback.sql (aparte).

alter table public.fact_prefacturas add column if not exists conciliacion jsonb;
comment on column public.fact_prefacturas.conciliacion is
  'Conciliación con una factura emitida fuera de la app: comprobante, diferencia con lo calculado y su estado (sin_diferencia/pendiente/explicada/resuelta).';

create or replace function public.fact_prefactura_conciliar(p_prefactura_id uuid, p_version integer, p_comprobante_id uuid, p_datos jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  v_actor uuid := public.facturacion_gate();
  v public.fact_prefacturas; k public.fact_comprobantes; v_cfg jsonb;
  v_dif bigint; v_estado_dif text; v_conc jsonb;
  d jsonb := coalesce(p_datos, '{}'::jsonb);
begin
  perform public.fact_modulo_exigir('emision_manual');
  select * into v from public.fact_prefacturas where id = p_prefactura_id for update;
  if v.id is null then raise exception 'Prefactura inexistente'; end if;
  if v.version <> p_version then raise exception 'La prefactura cambió; recargá' using errcode = '40001'; end if;
  if v.estado not in ('en_preparacion', 'esperando_requisitos', 'lista_revision', 'aprobada_emitir') then
    raise exception 'La prefactura está %: sólo se concilian las que todavía no se emitieron', v.estado;
  end if;
  -- Si la app ya mandó (o está mandando) esta prefactura a ARCA, no se concilia con otra factura.
  if exists (select 1 from public.fact_emisiones e where e.prefactura_id = v.id and e.ambiente = 'produccion'
             and e.estado in ('enviando', 'incierta', 'autorizada')) then
    raise exception 'Hay una emisión de la app en curso, incierta o autorizada para esta prefactura: no se concilia con otra factura';
  end if;
  -- Sin importe calculado (faltan horas aprobadas o requisitos) no hay con qué comparar la factura, y
  -- conciliarla la dejaría emitida y congelada sin importe (p. ej. Nación con horas en revisión).
  if v.total_c is null then
    raise exception 'La prefactura todavía no tiene importe (faltan horas aprobadas o requisitos): completala antes de conciliar';
  end if;

  select * into k from public.fact_comprobantes where id = p_comprobante_id for update;
  if k.id is null then raise exception 'Comprobante inexistente'; end if;
  if k.ambiente <> 'produccion' or k.tipo not in (1, 6, 201) then raise exception 'Sólo se concilian facturas de producción (A, B o FCE A)'; end if;
  if k.prefactura_id is not null then raise exception 'Ese comprobante ya está conciliado con una prefactura'; end if;
  select valor into v_cfg from public.fact_config where clave = 'emision';
  if k.cuit_emisor is distinct from regexp_replace(coalesce(v_cfg->>'cuit_emisor', ''), '\D', '', 'g') then
    raise exception 'El comprobante no es del CUIT emisor de la empresa';
  end if;
  if regexp_replace(coalesce(k.doc_nro_receptor, ''), '\D', '', 'g') is distinct from v.cuit_receptor then
    raise exception 'El CUIT del receptor del comprobante no es el de la prefactura';
  end if;
  if coalesce(k.cae, '') !~ '^\d{14}$' then raise exception 'El comprobante no tiene CAE'; end if;

  v_dif := case when v.total_c is null then null else k.total_c - v.total_c end;
  v_estado_dif := case
    when v_dif = 0 and k.tipo = v.tipo_comprobante then 'sin_diferencia'
    when d->>'estado_diferencia' in ('pendiente', 'explicada', 'resuelta') then d->>'estado_diferencia'
    else 'pendiente' end;
  v_conc := jsonb_build_object(
    'comprobante_id', k.id, 'tipo', k.tipo, 'punto_venta', k.punto_venta, 'numero', k.numero, 'fecha', k.fecha_emision, 'cae', k.cae,
    'neto_c', k.neto_c, 'iva_c', k.iva_c, 'total_c', k.total_c,
    'tipo_app', v.tipo_comprobante, 'total_app_c', v.total_c, 'diferencia_c', v_dif,
    'horas_facturadas', d->'horas_facturadas', 'horas_app', d->'horas_app', 'periodo_facturado', d->'periodo_facturado',
    'estado_diferencia', v_estado_dif, 'motivo', nullif(trim(coalesce(d->>'motivo', '')), ''),
    'origen', coalesce(nullif(d->>'origen', ''), 'manual'), 'estado_previo', v.estado, 'at', now(), 'por', v_actor);

  update public.fact_comprobantes set prefactura_id = v.id, cliente_id = coalesce(cliente_id, v.cliente_id),
    notas = coalesce(notas || ' · ', '') || 'Conciliado con su prefactura (factura emitida fuera de la app)'
  where id = k.id;
  -- La API ya no puede emitir esta prefactura.
  update public.fact_emisiones set estado = 'abandonada', observaciones = 'Facturada fuera de la app (comprobante conciliado)', updated_at = now()
   where prefactura_id = v.id and ambiente = 'produccion' and estado in ('preparada', 'rechazada');
  update public.fact_prefacturas set estado = 'emitida', conciliacion = v_conc, actualizado_por = v_actor where id = v.id;
  if v.oc_id is not null then
    insert into public.fact_oc_consumos (oc_id, prefactura_id, neto_c, total_c, horas)
    values (v.oc_id, v.id, k.neto_c, k.total_c, coalesce(v.minutos_aprobados, 0) / 60.0)
    on conflict (oc_id, prefactura_id) where anulado_at is null do nothing;
  end if;
  perform public.fact_registrar('prefactura', v.id, 'conciliada', v_conc, v_actor);
  perform public.fact_registrar('comprobante', k.id, 'conciliado', jsonb_build_object('prefactura_id', v.id, 'estado_diferencia', v_estado_dif), v_actor);
  return v_conc;
end $fn$;
revoke all on function public.fact_prefactura_conciliar(uuid, integer, uuid, jsonb) from public, anon;
grant execute on function public.fact_prefactura_conciliar(uuid, integer, uuid, jsonb) to authenticated, service_role;

create or replace function public.fact_conciliacion_diferencia(p_prefactura_id uuid, p_estado text, p_motivo text, p_periodo_facturado jsonb default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_prefacturas;
begin
  if p_estado not in ('pendiente', 'explicada', 'resuelta') then raise exception 'Estado de diferencia inválido: %', p_estado; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indicá el motivo'; end if;
  select * into v from public.fact_prefacturas where id = p_prefactura_id for update;
  if v.id is null or v.conciliacion is null then raise exception 'La prefactura no está conciliada con una factura'; end if;
  update public.fact_prefacturas set conciliacion = conciliacion || jsonb_build_object('estado_diferencia', p_estado, 'motivo', trim(p_motivo),
      'periodo_facturado', coalesce(p_periodo_facturado, conciliacion->'periodo_facturado'), 'revisado_at', now(), 'revisado_por', v_actor),
    actualizado_por = v_actor
  where id = v.id;
  perform public.fact_registrar('prefactura', v.id, 'diferencia_' || p_estado,
    jsonb_build_object('motivo', trim(p_motivo), 'periodo_facturado', p_periodo_facturado, 'antes', v.conciliacion->>'estado_diferencia'), v_actor);
end $fn$;
revoke all on function public.fact_conciliacion_diferencia(uuid, text, text, jsonb) from public, anon;
grant execute on function public.fact_conciliacion_diferencia(uuid, text, text, jsonb) to authenticated, service_role;

create or replace function public.fact_excepcion_duplicado(p_prefactura_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if not public.puede_acceder_gerencia_actual() then raise exception 'Sólo Gerencia autoriza una excepción' using errcode = '42501'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then raise exception 'Indicá el motivo de la excepción (al menos 10 caracteres)'; end if;
  if not exists (select 1 from public.fact_prefacturas where id = p_prefactura_id) then raise exception 'Prefactura inexistente'; end if;
  perform public.fact_registrar('prefactura', p_prefactura_id, 'excepcion_duplicado', jsonb_build_object('motivo', trim(p_motivo)), v_actor);
end $fn$;
revoke all on function public.fact_excepcion_duplicado(uuid, text) from public, anon;
grant execute on function public.fact_excepcion_duplicado(uuid, text) to authenticated, service_role;
