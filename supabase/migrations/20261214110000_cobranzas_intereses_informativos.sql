-- 20261214110000 · Intereses por mora INFORMATIVOS en Cobranzas (sólo para avisarle al cliente).
--
-- Gerencia (18/11/2026): Cobranzas muestra cuánto interés por mora lleva cada factura vencida (a la fecha si sigue
-- impaga; con los días cerrados el día del cobro si ya se pagó), sólo para avisarle al cliente. No se registran
-- intereses ni se emiten notas de débito: el cálculo lo hace la pantalla con las series del BCRA.
--   · Tasa general, para todos los contratos sin tasa propia: "BADLAR corregida" = BADLAR de bancos privados × factor
--     (fact_config.intereses; la cambia Gerencia con fact_intereses_config_guardar).
--   · Cada contrato puede tener otra (fact_contratos.mora_tasa_tipo / mora_tasa_factor, por
--     fact_contrato_condiciones_guardar): BADLAR × su factor, TIM del BCRA, tasa fija pactada (mora_tasa /
--     mora_tasa_periodo, ya existentes) o sin intereses.
--   · Por factura se puede marcar "no cobrar" con motivo (fact_interes_no_cobrar), con historial.
-- No cambia saldos, cobros, vencimientos ni comprobantes.
-- Rollback: supabase/rollback/20261214110000_cobranzas_intereses_informativos_rollback.sql (aparte).

-- ── Tasa por contrato (null = la general) ─────────────────────────────────────────────────────────────────────
alter table public.fact_contratos
  add column if not exists mora_tasa_tipo text,
  add column if not exists mora_tasa_factor numeric(9, 4);
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_tasa_tipo_check;
alter table public.fact_contratos add constraint fact_contratos_mora_tasa_tipo_check
  check (mora_tasa_tipo is null or mora_tasa_tipo in ('badlar', 'tim', 'fija', 'sin_interes'));
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_tasa_factor_check;
alter table public.fact_contratos add constraint fact_contratos_mora_tasa_factor_check
  check (mora_tasa_factor is null or (mora_tasa_factor > 0 and mora_tasa_factor <= 10));
alter table public.fact_contratos drop constraint if exists fact_contratos_mora_fija_con_tasa;
alter table public.fact_contratos add constraint fact_contratos_mora_fija_con_tasa
  check (mora_tasa_tipo is distinct from 'fija' or (mora_tasa is not null and mora_tasa_periodo is not null));
comment on column public.fact_contratos.mora_tasa_tipo is
  'Tasa de los intereses por mora informativos de Cobranzas: null = la general (fact_config.intereses); badlar (x mora_tasa_factor), tim, fija (mora_tasa / mora_tasa_periodo) o sin_interes.';

-- ── Tasa general: BADLAR corregida (x factor) ─────────────────────────────────────────────────────────────────
insert into public.fact_config (clave, valor)
select 'intereses', '{"tipo": "badlar", "factor": 1}'::jsonb
where not exists (select 1 from public.fact_config where clave = 'intereses');

create or replace function public.fact_intereses_config_guardar(p_valor jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_ant jsonb; v_tipo text := p_valor->>'tipo'; v_factor numeric; v_tasa numeric; v_periodo text;
begin
  if not public.puede_acceder_gerencia_actual() then
    raise exception 'Sólo Gerencia cambia la tasa general de los intereses' using errcode = '42501';
  end if;
  if v_tipo is null or v_tipo not in ('badlar', 'tim', 'fija', 'sin_interes') then
    raise exception 'Tasa inválida: %', coalesce(v_tipo, '(vacía)');
  end if;
  if v_tipo = 'badlar' then
    v_factor := nullif(p_valor->>'factor', '')::numeric;
    if v_factor is null or v_factor <= 0 or v_factor > 10 then raise exception 'El factor de la BADLAR tiene que ser mayor que 0 y hasta 10'; end if;
  end if;
  if v_tipo = 'fija' then
    v_tasa := nullif(p_valor->>'tasa', '')::numeric;
    v_periodo := p_valor->>'periodo';
    if v_tasa is null or v_tasa <= 0 or coalesce(v_periodo, '') not in ('anual', 'mensual', 'diaria') then
      raise exception 'Indicá la tasa fija y su período (anual, mensual o diaria)';
    end if;
  end if;
  select valor into v_ant from public.fact_config where clave = 'intereses' for update;
  insert into public.fact_config (clave, valor, actualizado_at)
  values ('intereses', jsonb_strip_nulls(jsonb_build_object('tipo', v_tipo, 'factor', v_factor, 'tasa', v_tasa, 'periodo', v_periodo)), now())
  on conflict (clave) do update set valor = excluded.valor, actualizado_at = now();
  perform public.fact_registrar('config', gen_random_uuid(), 'intereses', jsonb_build_object('anterior', v_ant, 'nuevo', p_valor), v_actor);
end $fn$;
revoke all on function public.fact_intereses_config_guardar(jsonb) from public, anon;
grant execute on function public.fact_intereses_config_guardar(jsonb) to authenticated, service_role;

-- ── Condiciones del contrato: suma la tasa de los intereses ───────────────────────────────────────────────────
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
    mora_tasa_tipo = case when p_datos ? 'mora_tasa_tipo' then nullif(p_datos->>'mora_tasa_tipo', '') else mora_tasa_tipo end,
    mora_tasa_factor = case when p_datos ? 'mora_tasa_factor' then nullif(p_datos->>'mora_tasa_factor', '')::numeric else mora_tasa_factor end,
    condiciones_documento_id = case when p_datos ? 'condiciones_documento_id' then nullif(p_datos->>'condiciones_documento_id', '')::uuid else condiciones_documento_id end,
    version = version + 1, actualizado_por = v_actor, updated_at = now()
  where id = p_contrato_id;
  perform public.fact_registrar('contrato', p_contrato_id, 'condiciones_comerciales', jsonb_build_object('nuevas', p_datos,
    'anteriores', jsonb_build_object('dias_vencimiento', k.dias_vencimiento, 'pago_evento', k.pago_evento, 'pago_dia_mes', k.pago_dia_mes,
      'mora_tasa', k.mora_tasa, 'mora_tasa_periodo', k.mora_tasa_periodo, 'mora_metodo', k.mora_metodo, 'mora_gracia_dias', k.mora_gracia_dias,
      'mora_condiciones', k.mora_condiciones, 'mora_tasa_tipo', k.mora_tasa_tipo, 'mora_tasa_factor', k.mora_tasa_factor)), v_actor);
end $fn$;
revoke all on function public.fact_contrato_condiciones_guardar(uuid, jsonb) from public, anon;
grant execute on function public.fact_contrato_condiciones_guardar(uuid, jsonb) to authenticated, service_role;

-- ── "No cobrar" los intereses de una factura ───────────────────────────────────────────────────────────────────
alter table public.fact_comprobante_seguimiento
  add column if not exists interes_no_cobrar boolean not null default false,
  add column if not exists interes_no_cobrar_motivo text,
  add column if not exists interes_no_cobrar_por uuid references public.usuarios(id) on delete set null,
  add column if not exists interes_no_cobrar_at timestamptz;
alter table public.fact_comprobante_seguimiento drop constraint if exists fact_comprobante_seguimiento_interes_motivo;
alter table public.fact_comprobante_seguimiento add constraint fact_comprobante_seguimiento_interes_motivo
  check (not interes_no_cobrar or length(trim(coalesce(interes_no_cobrar_motivo, ''))) > 3);

create or replace function public.fact_interes_no_cobrar(p_comprobante_id uuid, p_no_cobrar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); s public.fact_comprobante_seguimiento; v_no boolean := coalesce(p_no_cobrar, false);
begin
  if not exists (select 1 from public.fact_comprobantes where id = p_comprobante_id and ambiente = 'produccion' and tipo in (1, 6, 201)) then
    raise exception 'Sólo facturas de producción';
  end if;
  if v_no and length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indicá por qué no se cobran los intereses'; end if;
  insert into public.fact_comprobante_seguimiento (comprobante_id, actualizado_por) values (p_comprobante_id, v_actor)
  on conflict (comprobante_id) do nothing;
  select * into s from public.fact_comprobante_seguimiento where comprobante_id = p_comprobante_id for update;
  update public.fact_comprobante_seguimiento set
    interes_no_cobrar = v_no,
    interes_no_cobrar_motivo = case when v_no then trim(p_motivo) end,
    interes_no_cobrar_por = case when v_no then v_actor end,
    interes_no_cobrar_at = case when v_no then now() end,
    version = version + 1, actualizado_por = v_actor, updated_at = now()
  where comprobante_id = p_comprobante_id;
  perform public.fact_registrar('comprobante', p_comprobante_id, case when v_no then 'interes_no_cobrar' else 'interes_cobrar' end,
    jsonb_build_object('motivo', nullif(trim(coalesce(p_motivo, '')), ''), 'antes', coalesce(s.interes_no_cobrar, false)), v_actor);
end $fn$;
revoke all on function public.fact_interes_no_cobrar(uuid, boolean, text) from public, anon;
grant execute on function public.fact_interes_no_cobrar(uuid, boolean, text) to authenticated, service_role;
