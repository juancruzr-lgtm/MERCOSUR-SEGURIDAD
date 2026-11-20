-- Cobranzas: cargos sin factura (remitos) en la cuenta del cliente.
-- Algunos clientes pagan, además de la factura, un importe por remito que no se factura. Para que la cuenta del
-- cliente muestre la deuda real y se sepa qué factura y qué remito cubre cada pago, el remito se registra como un
-- cargo del cliente y los cobros se le pueden aplicar igual que a una factura.
-- No es un comprobante fiscal: no va a ARCA ni entra en emisión, IVA ni tablero de facturación.
-- No se borra: se anula con motivo (revierte sus aplicaciones) y queda en el historial.

create table if not exists public.fact_cargos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.fact_clientes(id),
  fecha           date not null,
  periodo         text check (periodo is null or periodo ~ '^\d{4}-\d{2}$'),
  tipo            text not null default 'remito' check (tipo in ('remito', 'otro')),
  descripcion     text not null check (length(trim(descripcion)) >= 3),
  importe_c       bigint not null check (importe_c > 0),
  notas           text,
  creado_por      uuid references public.usuarios(id) on delete set null,
  created_at      timestamptz not null default now(),
  anulado_por     uuid references public.usuarios(id) on delete set null,
  anulado_at      timestamptz,
  anulado_motivo  text
);
create index if not exists ix_fact_cargos_cliente on public.fact_cargos (cliente_id, fecha) where anulado_at is null;

alter table public.fact_cargos enable row level security;
revoke all on public.fact_cargos from public, anon, authenticated;
grant select on public.fact_cargos to authenticated;
drop policy if exists fact_cargos_lectura on public.fact_cargos;
create policy fact_cargos_lectura on public.fact_cargos for select to authenticated using (public.facturacion_puede_actual());
do $do$
begin
  if to_regprocedure('public.acceso_habilitado_actual()') is not null then
    drop policy if exists acceso_bloqueado_baja on public.fact_cargos;
    create policy acceso_bloqueado_baja on public.fact_cargos as restrictive for all to authenticated
      using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
  end if;
end
$do$;

-- Una aplicación cancela exactamente uno: factura, saldo inicial o cargo sin factura.
alter table public.fact_aplicaciones add column if not exists cargo_id uuid references public.fact_cargos(id);
alter table public.fact_aplicaciones drop constraint if exists fact_aplicaciones_check1;
alter table public.fact_aplicaciones drop constraint if exists fact_aplicaciones_destino_unico;
alter table public.fact_aplicaciones add constraint fact_aplicaciones_destino_unico
  check ((comprobante_id is not null)::int + (saldo_inicial_id is not null)::int + (cargo_id is not null)::int = 1);
drop index if exists public.ux_fact_aplicacion_vigente;
create unique index ux_fact_aplicacion_vigente on public.fact_aplicaciones
  (coalesce(cobro_id, retencion_id), coalesce(comprobante_id, saldo_inicial_id, cargo_id)) where revertida_at is null;
create index if not exists ix_fact_aplic_cargo on public.fact_aplicaciones (cargo_id) where revertida_at is null and cargo_id is not null;

-- Saldo de cada cargo (para la cuenta del cliente).
create or replace view public.fact_v_cargos with (security_invoker = true) as
select g.*, coalesce(ap.t, 0) as aplicado_c, g.importe_c - coalesce(ap.t, 0) as saldo_c
from public.fact_cargos g
left join lateral (select sum(a.importe_c) t from public.fact_aplicaciones a where a.cargo_id = g.id and a.revertida_at is null) ap on true
where g.anulado_at is null;
revoke all on public.fact_v_cargos from public, anon;
grant select on public.fact_v_cargos to authenticated;

-- Alta idempotente: p_id lo genera la pantalla.
create or replace function public.fact_cargo_registrar(p_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  perform public.fact_modulo_exigir('cobranzas');
  if p_id is null then raise exception 'Falta el identificador del cargo'; end if;
  if exists (select 1 from public.fact_cargos where id = p_id) then return p_id; end if;
  if not exists (select 1 from public.fact_clientes where id = (p_datos->>'cliente_id')::uuid) then raise exception 'Cliente inexistente'; end if;
  insert into public.fact_cargos (id, cliente_id, fecha, periodo, tipo, descripcion, importe_c, notas, creado_por)
  values (p_id, (p_datos->>'cliente_id')::uuid, (p_datos->>'fecha')::date, nullif(p_datos->>'periodo', ''),
          coalesce(nullif(p_datos->>'tipo', ''), 'remito'), trim(coalesce(p_datos->>'descripcion', '')),
          (p_datos->>'importe_c')::bigint, nullif(trim(coalesce(p_datos->>'notas', '')), ''), v_actor);
  perform public.fact_registrar('cargo', p_id, 'alta', p_datos, v_actor);
  return p_id;
end $fn$;

-- Anular un cargo cargado por error: revierte sus aplicaciones (los cobros quedan disponibles). Idempotente.
create or replace function public.fact_cargo_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); g public.fact_cargos; v_n int;
begin
  perform public.fact_modulo_exigir('cobranzas');
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into g from public.fact_cargos where id = p_id for update;
  if g.id is null then raise exception 'Cargo inexistente'; end if;
  if g.anulado_at is not null then return; end if;
  update public.fact_aplicaciones set revertida_at = now(), revertida_por = v_actor, revertida_motivo = 'Cargo anulado: ' || trim(p_motivo)
   where cargo_id = p_id and revertida_at is null;
  get diagnostics v_n = row_count;
  update public.fact_cargos set anulado_at = now(), anulado_por = v_actor, anulado_motivo = trim(p_motivo) where id = p_id;
  perform public.fact_registrar('cargo', p_id, 'anulado', jsonb_build_object('motivo', p_motivo, 'aplicaciones_revertidas', v_n), v_actor);
end $fn$;

-- Aplicar un cobro a un cargo sin factura (sólo cobros: las retenciones son fiscales y van a facturas).
create or replace function public.fact_aplicar_cargo(p_cobro_id uuid, p_cargo_id uuid, p_importe_c bigint, p_evidencia jsonb default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_cli uuid; v_cheque text; v_disp bigint; g public.fact_cargos; v_saldo bigint; v_id uuid;
begin
  perform public.fact_modulo_exigir('cobranzas');
  if p_importe_c is null or p_importe_c <= 0 then raise exception 'El importe a aplicar debe ser positivo'; end if;
  select cliente_id, cheque_estado into v_cli, v_cheque from public.fact_cobros where id = p_cobro_id and anulado_at is null for update;
  if v_cli is null then raise exception 'Cobro inexistente o anulado'; end if;
  if v_cheque in ('rechazado', 'anulado', 'endosado') then raise exception 'El cheque está %: no se aplica', v_cheque; end if;
  select * into g from public.fact_cargos where id = p_cargo_id for update;
  if g.id is null or g.anulado_at is not null then raise exception 'Cargo inexistente o anulado'; end if;
  if g.cliente_id <> v_cli then raise exception 'El cobro y el cargo son de clientes distintos'; end if;
  if exists (select 1 from public.fact_aplicaciones where cobro_id = p_cobro_id and cargo_id = p_cargo_id and revertida_at is null) then
    raise exception 'Ese cobro ya está aplicado a este cargo: revertí la aplicación para cambiar el importe';
  end if;
  v_disp := (select importe_c from public.fact_cobros where id = p_cobro_id)
            - coalesce((select sum(importe_c) from public.fact_aplicaciones where cobro_id = p_cobro_id and revertida_at is null), 0);
  v_saldo := g.importe_c - coalesce((select sum(importe_c) from public.fact_aplicaciones where cargo_id = p_cargo_id and revertida_at is null), 0);
  if p_importe_c > v_disp then raise exception 'El cobro tiene disponible % y se quiere aplicar %', v_disp, p_importe_c; end if;
  if p_importe_c > v_saldo then raise exception 'El cargo tiene saldo % y se quiere aplicar %', v_saldo, p_importe_c; end if;
  insert into public.fact_aplicaciones (cobro_id, cargo_id, importe_c, vinculo, evidencia, creado_por)
  values (p_cobro_id, p_cargo_id, p_importe_c, 'manual', coalesce(p_evidencia, '{}'::jsonb), v_actor)
  returning id into v_id;
  perform public.fact_registrar('aplicacion', v_id, 'alta', jsonb_build_object('cobro_id', p_cobro_id, 'cargo_id', p_cargo_id, 'importe_c', p_importe_c), v_actor);
  return v_id;
end $fn$;

revoke all on function public.fact_cargo_registrar(uuid, jsonb) from public, anon;
revoke all on function public.fact_cargo_anular(uuid, text) from public, anon;
revoke all on function public.fact_aplicar_cargo(uuid, uuid, bigint, jsonb) from public, anon;
grant execute on function public.fact_cargo_registrar(uuid, jsonb) to authenticated;
grant execute on function public.fact_cargo_anular(uuid, text) to authenticated;
grant execute on function public.fact_aplicar_cargo(uuid, uuid, bigint, jsonb) to authenticated;
