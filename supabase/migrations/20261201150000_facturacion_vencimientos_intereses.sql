-- ═══════════════════════════════════════════════════════════════════════════
-- 20261201150000 — Facturación (4/4): condiciones comerciales de pago,
-- vencimiento comercial, intereses por mora y registro de facturas emitidas
-- manualmente en "Comprobantes en línea" de ARCA (contingencia).
--
-- SIN APLICAR — requiere autorización expresa. Depende de 120000, 130000 y 140000.
-- Rollback: supabase/rollback/20261201150000_facturacion_vencimientos_intereses_rollback.sql
--
--  · El vencimiento comercial NO es el vencimiento del CAE ni el FchVtoPago
--    informado a ARCA: sale del contrato (plazo + evento que lo inicia:
--    emisión, presentación, recepción, conformidad o fecha fija) y de las
--    fechas reales de cada factura. Si falta la condición o la fecha del
--    evento, queda "pendiente de definir": no se inventa.
--  · Intereses: sólo con tasa, período y método cargados en el contrato.
--    Se calculan día a día sobre el saldo (pagos parciales, NC/ND, retenciones
--    con su fecha). Se proponen, se revisan con justificación, se aprueban y
--    recién ahí se puede SOLICITAR una nota de débito, que sigue el circuito
--    de notas (aprobación + emisión). Nada se aplica ni se emite solo.
--  · Factura emitida a mano en ARCA: se registra contra la prefactura aprobada
--    y vigente, con los mismos datos fiscales; desde ese momento la prefactura
--    queda emitida y la API no puede emitir otra.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── Condiciones comerciales en el contrato ─────────────────────────────────
-- dias_vencimiento (ya existente) es el PLAZO; pago_evento dice desde cuándo corre.
alter table public.fact_contratos
  add column if not exists pago_evento text check (pago_evento in ('emision', 'presentacion', 'recepcion', 'conformidad', 'fecha_fija')),
  add column if not exists pago_dia_mes integer check (pago_dia_mes between 1 and 31),
  add column if not exists mora_tasa numeric(9, 4) check (mora_tasa is null or mora_tasa > 0),
  add column if not exists mora_tasa_periodo text check (mora_tasa_periodo in ('anual', 'mensual', 'diaria')),
  add column if not exists mora_metodo text check (mora_metodo in ('simple')),
  add column if not exists mora_gracia_dias integer not null default 0 check (mora_gracia_dias between 0 and 365),
  add column if not exists mora_condiciones text,
  add column if not exists condiciones_documento_id uuid references public.fact_documentos(id);
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_completa;
alter table public.fact_contratos add constraint fact_contratos_mora_completa
  check (mora_tasa is null or (mora_tasa_periodo is not null and mora_metodo is not null));
alter table public.fact_contratos drop constraint if exists fact_contratos_fecha_fija;
alter table public.fact_contratos add constraint fact_contratos_fecha_fija
  check (pago_evento is distinct from 'fecha_fija' or pago_dia_mes is not null);

-- ── Seguimiento comercial de cada factura (fechas reales; lo fiscal no se toca) ──
create table if not exists public.fact_comprobante_seguimiento (
  comprobante_id            uuid primary key references public.fact_comprobantes(id),
  presentada_el             date,
  recibida_el               date,
  conformidad_el            date,
  vencimiento_manual        date,
  vencimiento_manual_motivo text,
  notas                     text,
  version                   integer not null default 1,
  actualizado_por           uuid references public.usuarios(id) on delete set null,
  updated_at                timestamptz not null default now(),
  check (vencimiento_manual is null or length(trim(coalesce(vencimiento_manual_motivo, ''))) > 3)
);

-- ── Intereses por mora ─────────────────────────────────────────────────────
create table if not exists public.fact_intereses (
  id               uuid primary key default gen_random_uuid(),
  comprobante_id   uuid not null references public.fact_comprobantes(id),
  desde            date not null,
  hasta            date not null check (hasta >= desde),
  importe_c        bigint not null check (importe_c > 0),
  calculo          jsonb not null,
  estado           text not null default 'potencial'
                     check (estado in ('potencial', 'revisado', 'aprobado', 'nd_solicitada', 'anulado')),
  justificacion    text,
  nota_emision_id  uuid references public.fact_emisiones(id),
  creado_por       uuid references public.usuarios(id) on delete set null,
  created_at       timestamptz not null default now(),
  revisado_por     uuid references public.usuarios(id) on delete set null,
  revisado_at      timestamptz,
  aprobado_por     uuid references public.usuarios(id) on delete set null,
  aprobado_at      timestamptz,
  anulado_por      uuid references public.usuarios(id) on delete set null,
  anulado_at       timestamptz,
  anulado_motivo   text,
  check (estado not in ('revisado', 'aprobado', 'nd_solicitada') or length(trim(coalesce(justificacion, ''))) > 3)
);
create index if not exists ix_fact_intereses_comp on public.fact_intereses (comprobante_id) where estado <> 'anulado';

do $do$
declare t text;
begin
  foreach t in array array['fact_comprobante_seguimiento', 'fact_intereses']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.facturacion_puede_actual())', t || '_lectura', t);
    if to_regprocedure('public.acceso_habilitado_actual()') is not null then
      execute format('drop policy if exists acceso_bloqueado_baja on public.%I', t);
      execute format('create policy acceso_bloqueado_baja on public.%I as restrictive for all to authenticated using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()))', t);
    end if;
  end loop;
end
$do$;

-- ── Contrato que rige una factura ──────────────────────────────────────────
-- Por su prefactura; si no tiene (importada de ARCA), el ÚNICO contrato vigente
-- del cliente. Con varios contratos y sin prefactura no se elige: queda pendiente.
create or replace function public.fact_contrato_de_comprobante(p_comprobante_id uuid)
returns public.fact_contratos language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare c public.fact_comprobantes; k public.fact_contratos;
begin
  select * into c from public.fact_comprobantes where id = p_comprobante_id;
  if c.id is null then return null; end if;
  if c.prefactura_id is not null then
    select k2.* into k from public.fact_prefacturas p join public.fact_contratos k2 on k2.id = p.contrato_id where p.id = c.prefactura_id;
    return k;
  end if;
  if c.cliente_id is null or (select count(*) from public.fact_contratos x where x.cliente_id = c.cliente_id and x.estado = 'vigente') <> 1 then
    return null;
  end if;
  select * into k from public.fact_contratos x where x.cliente_id = c.cliente_id and x.estado = 'vigente';
  return k;
end $fn$;
revoke all on function public.fact_contrato_de_comprobante(uuid) from public, anon, authenticated;

-- ── Vencimiento comercial ──────────────────────────────────────────────────
create or replace function public.fact_vencimiento_comercial(p_comprobante_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare c public.fact_comprobantes; k public.fact_contratos; s public.fact_comprobante_seguimiento;
  v_base date; v_d0 date; v_venc date; v_ult int;
begin
  select * into c from public.fact_comprobantes where id = p_comprobante_id;
  if c.id is null then return null; end if;
  select * into s from public.fact_comprobante_seguimiento where comprobante_id = c.id;
  if s.vencimiento_manual is not null then
    return jsonb_build_object('estado', 'manual', 'vencimiento', s.vencimiento_manual, 'motivo', s.vencimiento_manual_motivo);
  end if;
  k := public.fact_contrato_de_comprobante(c.id);
  if k.id is null or k.pago_evento is null or (k.dias_vencimiento is null and k.pago_evento <> 'fecha_fija') then
    return jsonb_build_object('estado', 'condicion_pendiente', 'vencimiento', null,
      'motivo', case when k.id is null then 'Factura sin contrato identificable' else 'Condición comercial pendiente de definir' end);
  end if;
  v_base := case k.pago_evento
    when 'emision' then c.fecha_emision when 'fecha_fija' then c.fecha_emision
    when 'presentacion' then s.presentada_el when 'recepcion' then s.recibida_el when 'conformidad' then s.conformidad_el end;
  if v_base is null then
    return jsonb_build_object('estado', 'evento_pendiente', 'vencimiento', null, 'evento', k.pago_evento,
      'motivo', 'Falta la fecha de ' || case k.pago_evento when 'presentacion' then 'presentación' when 'recepcion' then 'recepción' else 'conformidad' end);
  end if;
  v_d0 := v_base + coalesce(k.dias_vencimiento, 0);
  if k.pago_evento = 'fecha_fija' then
    -- Primer día de pago (pago_dia_mes, o fin de mes si no existe) en o después de emisión + plazo.
    v_ult := extract(day from (date_trunc('month', v_d0) + interval '1 month - 1 day'))::int;
    v_venc := make_date(extract(year from v_d0)::int, extract(month from v_d0)::int, least(k.pago_dia_mes, v_ult));
    if v_venc < v_d0 then
      v_d0 := (date_trunc('month', v_d0) + interval '1 month')::date;
      v_ult := extract(day from (date_trunc('month', v_d0) + interval '1 month - 1 day'))::int;
      v_venc := make_date(extract(year from v_d0)::int, extract(month from v_d0)::int, least(k.pago_dia_mes, v_ult));
    end if;
  else
    v_venc := v_d0;
  end if;
  return jsonb_build_object('estado', 'definido', 'vencimiento', v_venc, 'evento', k.pago_evento, 'base', v_base, 'dias', k.dias_vencimiento);
end $fn$;
revoke all on function public.fact_vencimiento_comercial(uuid) from public, anon, authenticated;

-- Movimientos que cambian el saldo de una factura, con su fecha: ND (+), NC (−),
-- cobros y retenciones aplicados (−, a la fecha del cobro o de la retención).
create or replace function public.fact_movimientos_saldo(p_comprobante_id uuid)
returns table (fecha date, importe bigint) language sql stable security definer set search_path = public, pg_catalog as $fn$
  select n.fecha_emision, case when n.tipo in (2, 7, 202) then n.total_c else -n.total_c end
    from public.fact_comprobantes n join public.fact_comprobantes c on c.id = p_comprobante_id
   where n.asociado_id = c.id and n.ambiente = c.ambiente
  union all
  select coalesce(cb.fecha, rt.fecha), -a.importe_c
    from public.fact_aplicaciones a
    left join public.fact_cobros cb on cb.id = a.cobro_id
    left join public.fact_retenciones rt on rt.id = a.retencion_id
   where a.comprobante_id = p_comprobante_id and a.revertida_at is null
$fn$;
revoke all on function public.fact_movimientos_saldo(uuid) from public, anon, authenticated;

-- ── Cálculo de intereses (sin efectos) ─────────────────────────────────────
-- Interés simple día a día sobre el saldo. Un pago, NC o retención del día d
-- ya no devenga ese día. Tasa diaria = anual/365, mensual/30 o diaria.
create or replace function public.fact_interes_calcular(p_comprobante_id uuid, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare c public.fact_comprobantes; k public.fact_contratos; v jsonb; v_venc date; v_desde date; v_div numeric;
  v_saldo bigint; v_tramos jsonb := '[]'::jsonb; v_total bigint := 0; v_ini date; r record; v_int bigint;
begin
  select * into c from public.fact_comprobantes where id = p_comprobante_id;
  if c.id is null or c.tipo not in (1, 6, 201) or c.ambiente <> 'produccion' then
    return jsonb_build_object('estado', 'no_aplica', 'motivo', 'Sólo facturas de producción');
  end if;
  v := public.fact_vencimiento_comercial(c.id);
  if v->>'estado' not in ('definido', 'manual') then
    return jsonb_build_object('estado', 'sin_vencimiento', 'motivo', v->>'motivo');
  end if;
  v_venc := (v->>'vencimiento')::date;
  k := public.fact_contrato_de_comprobante(c.id);
  if k.id is null or k.mora_tasa is null then
    return jsonb_build_object('estado', 'sin_clausula', 'vencimiento', v_venc, 'motivo', 'El contrato no tiene cláusula de interés cargada');
  end if;
  v_desde := v_venc + k.mora_gracia_dias + 1;
  if p_hasta < v_desde then
    return jsonb_build_object('estado', 'no_vencida', 'vencimiento', v_venc, 'importe_c', 0);
  end if;
  v_div := case k.mora_tasa_periodo when 'anual' then 36500 when 'mensual' then 3000 else 100 end;

  -- Saldo al comienzo del primer día de mora y movimientos posteriores, por fecha.
  select c.total_c + coalesce(sum(m.importe), 0) into v_saldo from public.fact_movimientos_saldo(c.id) m where m.fecha <= v_desde;
  v_ini := v_desde;
  for r in select m.fecha, sum(m.importe) imp from public.fact_movimientos_saldo(c.id) m
            where m.fecha > v_desde and m.fecha <= p_hasta group by m.fecha order by m.fecha loop
    if v_saldo > 0 then
      v_int := round(v_saldo::numeric * k.mora_tasa * (r.fecha - v_ini) / v_div);
      if v_int > 0 then
        v_tramos := v_tramos || jsonb_build_object('desde', v_ini, 'hasta', r.fecha - 1, 'dias', r.fecha - v_ini, 'saldo_c', v_saldo, 'interes_c', v_int);
        v_total := v_total + v_int;
      end if;
    end if;
    v_saldo := v_saldo + r.imp;
    v_ini := r.fecha;
  end loop;
  if v_saldo > 0 then
    v_int := round(v_saldo::numeric * k.mora_tasa * (p_hasta - v_ini + 1) / v_div);
    if v_int > 0 then
      v_tramos := v_tramos || jsonb_build_object('desde', v_ini, 'hasta', p_hasta, 'dias', p_hasta - v_ini + 1, 'saldo_c', v_saldo, 'interes_c', v_int);
      v_total := v_total + v_int;
    end if;
  end if;
  return jsonb_build_object('estado', 'calculado', 'vencimiento', v_venc, 'desde', v_desde, 'hasta', p_hasta,
    'tasa', k.mora_tasa, 'periodo', k.mora_tasa_periodo, 'metodo', k.mora_metodo, 'gracia_dias', k.mora_gracia_dias,
    'condiciones', k.mora_condiciones, 'tramos', v_tramos, 'importe_c', v_total, 'contrato_id', k.id);
end $fn$;
revoke all on function public.fact_interes_calcular(uuid, date) from public, anon, authenticated;

create or replace function public.fact_interes_simular(p_comprobante_id uuid, p_hasta date)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  perform public.facturacion_gate();
  return public.fact_interes_calcular(p_comprobante_id, p_hasta);
end $fn$;

create or replace function public.fact_interes_proponer(p_comprobante_id uuid, p_hasta date)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v jsonb; v_id uuid;
begin
  perform public.fact_modulo_exigir('intereses');
  perform 1 from public.fact_comprobantes where id = p_comprobante_id for update;
  v := public.fact_interes_calcular(p_comprobante_id, p_hasta);
  if v->>'estado' <> 'calculado' then raise exception 'No corresponde calcular intereses: %', coalesce(v->>'motivo', v->>'estado'); end if;
  if (v->>'importe_c')::bigint <= 0 then raise exception 'El cálculo no da interés a reclamar'; end if;
  if exists (select 1 from public.fact_intereses i where i.comprobante_id = p_comprobante_id and i.estado <> 'anulado'
             and i.desde <= p_hasta and i.hasta >= (v->>'desde')::date) then
    raise exception 'Ya hay un interés propuesto para ese período: anularlo antes de volver a calcular';
  end if;
  insert into public.fact_intereses (comprobante_id, desde, hasta, importe_c, calculo, creado_por)
  values (p_comprobante_id, (v->>'desde')::date, p_hasta, (v->>'importe_c')::bigint, v, v_actor) returning id into v_id;
  perform public.fact_registrar('interes', v_id, 'propuesto', v, v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_interes_revisar(p_id uuid, p_justificacion text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  perform public.fact_modulo_exigir('intereses');
  if length(trim(coalesce(p_justificacion, ''))) <= 3 then raise exception 'Indicá la justificación (cláusula, notificación, acuerdo)'; end if;
  update public.fact_intereses set estado = 'revisado', justificacion = p_justificacion, revisado_por = v_actor, revisado_at = now()
  where id = p_id and estado = 'potencial';
  if not found then raise exception 'El interés no está pendiente de revisión'; end if;
  perform public.fact_registrar('interes', p_id, 'revisado', jsonb_build_object('justificacion', p_justificacion), v_actor);
end $fn$;

-- Al aprobar se recalcula: si hubo pagos o cambió la condición, no se aprueba un número viejo.
create or replace function public.fact_interes_aprobar(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); i public.fact_intereses; v jsonb;
begin
  perform public.fact_modulo_exigir('intereses');
  select * into i from public.fact_intereses where id = p_id for update;
  if i.id is null or i.estado <> 'revisado' then raise exception 'Sólo se aprueba un interés revisado'; end if;
  v := public.fact_interes_calcular(i.comprobante_id, i.hasta);
  if v->>'estado' <> 'calculado' or (v->>'importe_c')::bigint <> i.importe_c then
    raise exception 'El cálculo cambió desde la propuesta (pagos o condiciones nuevas): anular y volver a proponer';
  end if;
  update public.fact_intereses set estado = 'aprobado', aprobado_por = v_actor, aprobado_at = now() where id = p_id;
  perform public.fact_registrar('interes', p_id, 'aprobado', jsonb_build_object('importe_c', i.importe_c), v_actor);
end $fn$;

create or replace function public.fact_interes_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  perform public.fact_modulo_exigir('intereses');
  if length(trim(coalesce(p_motivo, ''))) <= 3 then raise exception 'Indicá el motivo'; end if;
  update public.fact_intereses set estado = 'anulado', anulado_por = v_actor, anulado_at = now(), anulado_motivo = p_motivo
  where id = p_id and estado in ('potencial', 'revisado', 'aprobado');
  if not found then raise exception 'El interés no se puede anular (ya tiene nota de débito solicitada)'; end if;
  perform public.fact_registrar('interes', p_id, 'anulado', jsonb_build_object('motivo', p_motivo), v_actor);
end $fn$;

-- Solicita (NO emite) la nota de débito. El IVA del interés es una decisión que
-- toma Administración (p_iva_c explícito, puede ser 0); la ND sigue el circuito de notas.
create or replace function public.fact_interes_solicitar_nd(p_id uuid, p_iva_c bigint, p_motivo text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); i public.fact_intereses; c public.fact_comprobantes; v_emision uuid; v_tipo int;
begin
  perform public.fact_modulo_exigir('intereses');
  select * into i from public.fact_intereses where id = p_id for update;
  if i.id is null or i.estado <> 'aprobado' then raise exception 'Sólo un interés aprobado genera la solicitud de nota de débito'; end if;
  if p_iva_c is null or p_iva_c < 0 then raise exception 'Indicá el IVA de la nota de débito (puede ser 0)'; end if;
  select * into c from public.fact_comprobantes where id = i.comprobante_id;
  v_tipo := case c.tipo when 1 then 2 when 6 then 7 when 201 then 202 end;
  v_emision := public.fact_nota_solicitar(c.id, v_tipo, i.importe_c, p_iva_c,
    coalesce(nullif(trim(p_motivo), ''), 'Intereses por mora ' || to_char(i.desde, 'DD/MM/YYYY') || ' a ' || to_char(i.hasta, 'DD/MM/YYYY')), c.ambiente);
  update public.fact_intereses set estado = 'nd_solicitada', nota_emision_id = v_emision where id = p_id;
  perform public.fact_registrar('interes', p_id, 'nd_solicitada', jsonb_build_object('emision_id', v_emision, 'iva_c', p_iva_c), v_actor);
  return v_emision;
end $fn$;

-- ── Condiciones comerciales y seguimiento (edición con historial) ──────────
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

create or replace function public.fact_seguimiento_registrar(p_comprobante_id uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); s public.fact_comprobante_seguimiento;
begin
  if not exists (select 1 from public.fact_comprobantes where id = p_comprobante_id and tipo in (1, 6, 201)) then
    raise exception 'Sólo se sigue el vencimiento de facturas';
  end if;
  insert into public.fact_comprobante_seguimiento (comprobante_id, actualizado_por) values (p_comprobante_id, v_actor)
  on conflict (comprobante_id) do nothing;
  select * into s from public.fact_comprobante_seguimiento where comprobante_id = p_comprobante_id for update;
  update public.fact_comprobante_seguimiento set
    presentada_el = case when p_datos ? 'presentada_el' then nullif(p_datos->>'presentada_el', '')::date else presentada_el end,
    recibida_el = case when p_datos ? 'recibida_el' then nullif(p_datos->>'recibida_el', '')::date else recibida_el end,
    conformidad_el = case when p_datos ? 'conformidad_el' then nullif(p_datos->>'conformidad_el', '')::date else conformidad_el end,
    vencimiento_manual = case when p_datos ? 'vencimiento_manual' then nullif(p_datos->>'vencimiento_manual', '')::date else vencimiento_manual end,
    vencimiento_manual_motivo = case when p_datos ? 'vencimiento_manual_motivo' then nullif(trim(p_datos->>'vencimiento_manual_motivo'), '') else vencimiento_manual_motivo end,
    notas = case when p_datos ? 'notas' then p_datos->>'notas' else notas end,
    version = version + 1, actualizado_por = v_actor, updated_at = now()
  where comprobante_id = p_comprobante_id;
  perform public.fact_registrar('comprobante', p_comprobante_id, 'seguimiento', jsonb_build_object('nuevos', p_datos,
    'anteriores', jsonb_build_object('presentada_el', s.presentada_el, 'recibida_el', s.recibida_el, 'conformidad_el', s.conformidad_el,
      'vencimiento_manual', s.vencimiento_manual)), v_actor);
end $fn$;

-- ── Vencimientos y mora de las facturas con saldo ──────────────────────────
-- estado_mora: sin_vencimiento · no_vencida · proxima (≤ 7 días) · vencida_sin_clausula ·
-- interes_potencial · interes_revisado · interes_aprobado · nd_solicitada
create or replace function public.fact_vencimientos(p_hoy date, p_cliente_id uuid default null, p_objetivo_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); r record; v jsonb; i jsonb; v_int public.fact_intereses; v_out jsonb := '[]'::jsonb;
  v_saldo bigint; v_estado text; v_venc date;
begin
  for r in
    select c.* from public.fact_comprobantes c
     where c.ambiente = 'produccion' and c.tipo in (1, 6, 201)
       and (p_cliente_id is null or c.cliente_id = p_cliente_id)
       and public.fact_comprobante_en_filtro(c, p_cliente_id, p_objetivo_id)
     order by c.fecha_emision
  loop
    v_saldo := public.fact_saldo_destino(r.id, null);
    continue when v_saldo <= 0;
    v := public.fact_vencimiento_comercial(r.id);
    v_venc := nullif(v->>'vencimiento', '')::date;
    select * into v_int from public.fact_intereses x where x.comprobante_id = r.id and x.estado <> 'anulado' order by x.created_at desc limit 1;
    i := null;
    if v_venc is null then v_estado := 'sin_vencimiento';
    elsif v_venc >= p_hoy then v_estado := case when v_venc <= p_hoy + 7 then 'proxima' else 'no_vencida' end;
    elsif v_int.id is not null then v_estado := case v_int.estado when 'potencial' then 'interes_potencial' when 'revisado' then 'interes_revisado'
                                                                    when 'aprobado' then 'interes_aprobado' else 'nd_solicitada' end;
    else
      i := public.fact_interes_calcular(r.id, p_hoy);
      v_estado := case when i->>'estado' = 'calculado' and (i->>'importe_c')::bigint > 0 then 'interes_potencial' else 'vencida_sin_clausula' end;
    end if;
    v_out := v_out || jsonb_build_object('comprobante_id', r.id, 'cliente_id', r.cliente_id, 'receptor', r.receptor_nombre, 'tipo', r.tipo,
      'punto_venta', r.punto_venta, 'numero', r.numero, 'fecha_emision', r.fecha_emision, 'total_c', r.total_c, 'saldo_c', v_saldo,
      'vencimiento', v, 'estado_mora', v_estado, 'dias_mora', case when v_venc < p_hoy then p_hoy - v_venc else 0 end,
      'interes_estimado_c', coalesce((i->>'importe_c')::bigint, v_int.importe_c), 'interes_id', v_int.id);
  end loop;
  return v_out;
end $fn$;

-- ── Tablero: prefacturas, vencimientos e intereses ─────────────────────────
create or replace function public.fact_tablero_vencimientos(p_mes text, p_hoy date, p_cliente_id uuid default null, p_objetivo_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v jsonb; v_pref jsonb; v_pres int;
begin
  v := public.fact_vencimientos(p_hoy, p_cliente_id, p_objetivo_id);
  select jsonb_build_object(
      'en_preparacion', count(*) filter (where estado = 'en_preparacion'),
      'bloqueadas', count(*) filter (where estado = 'esperando_requisitos'),
      'en_revision', count(*) filter (where estado = 'lista_revision'),
      'aprobadas_sin_emitir', count(*) filter (where estado = 'aprobada_emitir'),
      'emitidas', count(*) filter (where estado = 'emitida'),
      'total_aprobado_sin_emitir_c', coalesce(sum(total_c) filter (where estado = 'aprobada_emitir'), 0))
    into v_pref from public.fact_prefacturas p
   where p.periodo_mes = p_mes and p.estado <> 'descartada'
     and (p_cliente_id is null or p.cliente_id = p_cliente_id)
     and (p_objetivo_id is null or p.objetivo_id = p_objetivo_id
          or exists (select 1 from public.fact_contrato_objetivos co where co.contrato_id = p.contrato_id and co.objetivo_id = p_objetivo_id and co.anulado_at is null));
  -- Pendientes de presentación: el plazo corre desde la presentación y todavía no se registró.
  select count(*) into v_pres from jsonb_array_elements(v) x where x->'vencimiento'->>'estado' = 'evento_pendiente' and x->'vencimiento'->>'evento' = 'presentacion';
  return jsonb_build_object('prefacturas', v_pref,
    'pendientes_presentacion', v_pres,
    'sin_condicion', (select count(*) from jsonb_array_elements(v) x where x->>'estado_mora' = 'sin_vencimiento'),
    'proximas', jsonb_build_object('n', (select count(*) from jsonb_array_elements(v) x where x->>'estado_mora' = 'proxima'),
                                   'saldo_c', (select coalesce(sum((x->>'saldo_c')::bigint), 0) from jsonb_array_elements(v) x where x->>'estado_mora' = 'proxima')),
    'vencidas', jsonb_build_object('n', (select count(*) from jsonb_array_elements(v) x where (x->>'dias_mora')::int > 0),
                                   'saldo_c', (select coalesce(sum((x->>'saldo_c')::bigint), 0) from jsonb_array_elements(v) x where (x->>'dias_mora')::int > 0)),
    'pendiente_cobro_c', (select coalesce(sum((x->>'saldo_c')::bigint), 0) from jsonb_array_elements(v) x),
    'intereses_potenciales_c', (select coalesce(sum((x->>'interes_estimado_c')::bigint), 0) from jsonb_array_elements(v) x where x->>'estado_mora' = 'interes_potencial'),
    'intereses_aprobados_c', (select coalesce(sum((x->>'interes_estimado_c')::bigint), 0) from jsonb_array_elements(v) x where x->>'estado_mora' in ('interes_aprobado', 'nd_solicitada')),
    -- Los saldos dependen de los cobros cargados: hasta conciliar, no son saldos definitivos.
    'saldos_sujetos_a_conciliacion', true);
end $fn$;

-- ── Factura emitida a mano en ARCA (contingencia) ──────────────────────────
-- p_datos: {tipo, punto_venta, numero, fecha, cuit_receptor, neto_c, iva_c, total_c, cae, cae_vto, documento_id?}
create or replace function public.fact_comprobante_manual_registrar(p_prefactura_id uuid, p_version integer, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_prefacturas; v_cfg jsonb; v_comp uuid; x public.fact_comprobantes;
  v_tipo int := (p_datos->>'tipo')::int; v_pv int := (p_datos->>'punto_venta')::int; v_num bigint := (p_datos->>'numero')::bigint;
  v_fecha date := (p_datos->>'fecha')::date; v_cuit text := regexp_replace(coalesce(p_datos->>'cuit_receptor', ''), '\D', '', 'g');
  v_neto bigint := (p_datos->>'neto_c')::bigint; v_iva bigint := (p_datos->>'iva_c')::bigint; v_total bigint := (p_datos->>'total_c')::bigint;
  v_cae text := trim(coalesce(p_datos->>'cae', '')); v_cae_vto date := (p_datos->>'cae_vto')::date; v_req_portal boolean;
begin
  perform public.fact_modulo_exigir('emision_manual');
  select * into v from public.fact_prefacturas where id = p_prefactura_id for update;
  if v.id is null then raise exception 'Prefactura inexistente'; end if;
  if v.version <> p_version then raise exception 'La prefactura cambió; recargá' using errcode = '40001'; end if;
  if v.estado <> 'aprobada_emitir' or v.huella is distinct from v.huella_aprobada then
    raise exception 'Sólo se registra contra una prefactura aprobada y sin cambios desde la aprobación';
  end if;
  -- Nada en vuelo por la API: si hay un envío o una respuesta incierta, primero se resuelve.
  perform 1 from public.fact_emisiones e where e.prefactura_id = v.id for update;
  if exists (select 1 from public.fact_emisiones e where e.prefactura_id = v.id and e.ambiente = 'produccion' and e.estado in ('enviando', 'incierta')) then
    raise exception 'Hay una emisión por ARCA en curso o incierta para esta prefactura: consultarla antes de registrar una manual';
  end if;
  if exists (select 1 from public.fact_emisiones e where e.prefactura_id = v.id and e.ambiente = 'produccion' and e.estado = 'autorizada') then
    raise exception 'La prefactura ya fue emitida por la API';
  end if;
  -- Los datos fiscales tienen que ser los aprobados.
  if v_tipo is distinct from v.tipo_comprobante then raise exception 'El tipo de comprobante (%) no es el aprobado (%)', v_tipo, v.tipo_comprobante; end if;
  if v_cuit is distinct from v.cuit_receptor then raise exception 'El CUIT del receptor no es el de la prefactura'; end if;
  if v_total is distinct from v.total_c then raise exception 'El total (%) no es el aprobado (%)', v_total, v.total_c; end if;
  if abs(v_neto - v.neto_c) > 2 or abs(v_iva - v.iva_c) > 2 or abs(v_neto + v_iva - v_total) > 2 then
    raise exception 'Neto e IVA no coinciden con la prefactura aprobada';
  end if;
  if v_pv is null or v_pv not between 1 and 99998 or v_num is null or v_num < 1 then raise exception 'Punto de venta o número inválido'; end if;
  if v_cae !~ '^\d{14}$' then raise exception 'El CAE tiene 14 dígitos'; end if;
  if v_fecha is null or v_fecha > current_date or v_cae_vto is null or v_cae_vto < v_fecha then raise exception 'Fecha de emisión o vencimiento del CAE inválidos'; end if;
  select valor into v_cfg from public.fact_config where clave = 'emision';

  select * into x from public.fact_comprobantes c where c.ambiente = 'produccion' and c.cuit_emisor = v_cfg->>'cuit_emisor'
     and c.tipo = v_tipo and c.punto_venta = v_pv and c.numero = v_num for update;
  if x.id is not null then
    -- Ya importado del CSV de ARCA: se vincula si es el mismo comprobante.
    if x.prefactura_id is not null then raise exception 'Ese comprobante ya está vinculado a otra prefactura'; end if;
    if x.total_c <> v_total or x.doc_nro_receptor is distinct from v_cuit or (x.cae is not null and x.cae <> v_cae) then
      raise exception 'ARCA ya tiene registrado ese número con otros datos: revisar';
    end if;
    update public.fact_comprobantes set prefactura_id = v.id, cliente_id = coalesce(cliente_id, v.cliente_id),
      notas = coalesce(notas || ' · ', '') || 'Vinculado a prefactura (emisión manual)' where id = x.id;
    v_comp := x.id;
  else
    insert into public.fact_comprobantes (ambiente, cuit_emisor, tipo, punto_venta, numero, fecha_emision, cliente_id, doc_tipo_receptor, doc_nro_receptor,
      concepto, servicio_desde, servicio_hasta, vto_pago, neto_c, iva_c, total_c, cae, cae_vto, origen, prefactura_id, notas, creado_por)
    values ('produccion', v_cfg->>'cuit_emisor', v_tipo, v_pv, v_num, v_fecha, v.cliente_id, 80, v_cuit,
      2, v.periodo_desde, v.periodo_hasta_excl - 1, v.fecha_vencimiento, v_neto, v_iva, v_total, v_cae, v_cae_vto, 'carga_manual', v.id,
      'Emitido manualmente en Comprobantes en línea', v_actor)
    returning id into v_comp;
  end if;
  -- La API ya no puede emitir esta prefactura.
  update public.fact_emisiones set estado = 'abandonada', observaciones = 'Emitida manualmente en ARCA (comprobante registrado)', updated_at = now()
   where prefactura_id = v.id and estado in ('preparada', 'rechazada');
  select coalesce(k.requiere_portal, false) into v_req_portal from public.fact_contratos k where k.id = v.contrato_id;
  update public.fact_prefacturas set estado = 'emitida', actualizado_por = v_actor,
    estado_portal = case when coalesce(v_req_portal, false) then 'pendiente' else estado_portal end
  where id = v.id;
  if v.oc_id is not null then
    insert into public.fact_oc_consumos (oc_id, prefactura_id, neto_c, total_c, horas)
    values (v.oc_id, v.id, v.neto_c, v.total_c, coalesce(v.minutos_aprobados, 0) / 60.0)
    on conflict (oc_id, prefactura_id) where anulado_at is null do nothing;
  end if;
  if nullif(p_datos->>'documento_id', '') is not null then
    insert into public.fact_documento_vinculos (documento_id, entidad, entidad_id, creado_por)
    values ((p_datos->>'documento_id')::uuid, 'comprobante', v_comp, v_actor) on conflict do nothing;
  end if;
  perform public.fact_registrar('prefactura', v.id, 'emitida_manual', p_datos || jsonb_build_object('comprobante_id', v_comp), v_actor);
  perform public.fact_registrar('comprobante', v_comp, 'registrado_manual', jsonb_build_object('prefactura_id', v.id), v_actor);
  return v_comp;
end $fn$;

-- ── Alcance para calcular horas facturables ────────────────────────────────
-- Las horas se leen de turnos y fichajes con la RLS de quien calcula. Con
-- alcance parcial vería menos turnos y facturaría de menos SIN error: se exige
-- alcance total (hoy lo tienen Gerencia y Administración).
create or replace function public.fact_alcance_total_actual()
returns boolean language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v text;
begin
  if to_regprocedure('public.alcance_operativo_de(uuid)') is null then return true; end if;
  execute 'select public.alcance_operativo_de($1)' into v using v_actor;
  return coalesce(v = 'todas', false);
end $fn$;

-- ── Datos del emisor impresos en el comprobante ────────────────────────────
-- Sólo lo seguro (razón social, CUIT, condición: emite factura A). Domicilio
-- comercial, Ingresos Brutos e inicio de actividades quedan vacíos hasta que
-- Administración los cargue: sin ellos no se genera el PDF.
insert into public.fact_config (clave, valor) values ('emisor', jsonb_build_object(
  'razon_social', 'MERCOSUR SEGURIDAD S.R.L.', 'cuit', '30710705417', 'condicion_iva', 'IVA Responsable Inscripto',
  'domicilio', null, 'iibb', null, 'inicio_actividades', null, 'cbu_fce', null))
on conflict (clave) do nothing;

create or replace function public.fact_emisor_guardar(p_datos jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_ant jsonb; k text;
begin
  select valor into v_ant from public.fact_config where clave = 'emisor' for update;
  for k in select jsonb_object_keys(p_datos) loop
    if k not in ('domicilio', 'iibb', 'inicio_actividades', 'cbu_fce') then raise exception 'Campo no editable: %', k; end if;
  end loop;
  update public.fact_config set valor = valor || p_datos, actualizado_at = now() where clave = 'emisor';
  perform public.fact_registrar('config', gen_random_uuid(), 'emisor', jsonb_build_object('anterior', v_ant, 'nuevo', p_datos), v_actor);
end $fn$;

do $do$
declare f text;
begin
  foreach f in array array['fact_alcance_total_actual()', 'fact_emisor_guardar(jsonb)', 'fact_interes_simular(uuid, date)', 'fact_interes_proponer(uuid, date)', 'fact_interes_revisar(uuid, text)',
    'fact_interes_aprobar(uuid)', 'fact_interes_anular(uuid, text)', 'fact_interes_solicitar_nd(uuid, bigint, text)',
    'fact_contrato_condiciones_guardar(uuid, jsonb)', 'fact_seguimiento_registrar(uuid, jsonb)', 'fact_vencimientos(date, uuid, uuid)',
    'fact_tablero_vencimientos(text, date, uuid, uuid)', 'fact_comprobante_manual_registrar(uuid, integer, jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$do$;

commit;
notify pgrst, 'reload schema';
