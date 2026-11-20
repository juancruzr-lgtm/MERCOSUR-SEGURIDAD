-- Cobranzas: seguimiento de reclamos de facturas impagas.
-- Cada reclamo es un registro de un cliente con las facturas que abarca, la fecha, el medio, a quién se le
-- reclamó, el detalle, la respuesta y, si hubo, la promesa de pago y la fecha del próximo contacto.
-- Reclamar no cambia el saldo ni el estado de la factura. No se borra: se anula con motivo y queda en el
-- historial. Alta idempotente por id generado en el cliente. Identidad y permiso: facturacion_gate() (auth.uid()).

create table if not exists public.fact_reclamos (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.fact_clientes(id),
  comprobante_ids    uuid[] not null check (cardinality(comprobante_ids) > 0),
  fecha              date not null,
  medio              text not null check (medio in ('mail', 'telefono', 'whatsapp', 'nota', 'carta_documento', 'portal', 'visita', 'otro')),
  contacto           text,
  detalle            text not null check (length(trim(detalle)) >= 5),
  respuesta          text,
  promesa_fecha      date,
  promesa_importe_c  bigint check (promesa_importe_c is null or promesa_importe_c > 0),
  proximo_contacto   date,
  documento_id       uuid references public.fact_documentos(id),
  creado_por         uuid references public.usuarios(id) on delete set null,
  created_at         timestamptz not null default now(),
  actualizado_por    uuid references public.usuarios(id) on delete set null,
  updated_at         timestamptz,
  anulado_por        uuid references public.usuarios(id) on delete set null,
  anulado_at         timestamptz,
  anulado_motivo     text
);
create index if not exists ix_fact_reclamos_cliente on public.fact_reclamos (cliente_id, fecha desc) where anulado_at is null;
create index if not exists ix_fact_reclamos_comprobantes on public.fact_reclamos using gin (comprobante_ids) where anulado_at is null;

alter table public.fact_reclamos enable row level security;
revoke all on public.fact_reclamos from public, anon, authenticated;
grant select on public.fact_reclamos to authenticated;
drop policy if exists fact_reclamos_lectura on public.fact_reclamos;
create policy fact_reclamos_lectura on public.fact_reclamos for select to authenticated using (public.facturacion_puede_actual());
do $do$
begin
  if to_regprocedure('public.acceso_habilitado_actual()') is not null then
    drop policy if exists acceso_bloqueado_baja on public.fact_reclamos;
    create policy acceso_bloqueado_baja on public.fact_reclamos as restrictive for all to authenticated
      using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
  end if;
end
$do$;

-- Alta. p_id lo genera la pantalla: si se reintenta, devuelve el mismo reclamo sin duplicarlo.
create or replace function public.fact_reclamo_registrar(p_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_cli uuid; v_comps uuid[]; v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_fecha date; v_medio text := p_datos->>'medio';
begin
  if p_id is null then raise exception 'Falta el identificador del reclamo'; end if;
  if exists (select 1 from public.fact_reclamos where id = p_id) then return p_id; end if;
  select array_agg(distinct x::uuid) into v_comps from jsonb_array_elements_text(coalesce(p_datos->'comprobante_ids', '[]'::jsonb)) x;
  if coalesce(cardinality(v_comps), 0) = 0 then raise exception 'Elegí al menos una factura'; end if;
  select min(cliente_id::text)::uuid into v_cli from public.fact_comprobantes where id = any(v_comps);
  if v_cli is null then raise exception 'Facturas inexistentes o sin cliente'; end if;
  if (select count(*) from public.fact_comprobantes where id = any(v_comps)) <> cardinality(v_comps)
     or exists (select 1 from public.fact_comprobantes where id = any(v_comps) and cliente_id is distinct from v_cli) then
    raise exception 'Todas las facturas del reclamo tienen que ser del mismo cliente';
  end if;
  v_fecha := coalesce(nullif(p_datos->>'fecha', '')::date, v_hoy);
  if v_fecha > v_hoy then raise exception 'La fecha del reclamo no puede ser futura'; end if;
  if v_medio is null then raise exception 'Indicá por qué medio se reclamó'; end if;
  insert into public.fact_reclamos (id, cliente_id, comprobante_ids, fecha, medio, contacto, detalle, respuesta, promesa_fecha, promesa_importe_c,
                                    proximo_contacto, documento_id, creado_por)
  values (p_id, v_cli, v_comps, v_fecha, v_medio, nullif(trim(coalesce(p_datos->>'contacto', '')), ''), trim(coalesce(p_datos->>'detalle', '')),
          nullif(trim(coalesce(p_datos->>'respuesta', '')), ''), nullif(p_datos->>'promesa_fecha', '')::date,
          nullif(p_datos->>'promesa_importe_c', '')::bigint, nullif(p_datos->>'proximo_contacto', '')::date,
          nullif(p_datos->>'documento_id', '')::uuid, v_actor);
  perform public.fact_registrar('reclamo', p_id, 'alta', p_datos, v_actor);
  return p_id;
end $fn$;

-- Completar lo que pasó después (respuesta, promesa, próximo contacto). Lo anterior queda en el historial.
create or replace function public.fact_reclamo_actualizar(p_id uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); r public.fact_reclamos;
begin
  select * into r from public.fact_reclamos where id = p_id for update;
  if r.id is null then raise exception 'Reclamo inexistente'; end if;
  if r.anulado_at is not null then raise exception 'El reclamo está anulado'; end if;
  update public.fact_reclamos set
    respuesta = case when p_datos ? 'respuesta' then nullif(trim(coalesce(p_datos->>'respuesta', '')), '') else respuesta end,
    promesa_fecha = case when p_datos ? 'promesa_fecha' then nullif(p_datos->>'promesa_fecha', '')::date else promesa_fecha end,
    promesa_importe_c = case when p_datos ? 'promesa_importe_c' then nullif(p_datos->>'promesa_importe_c', '')::bigint else promesa_importe_c end,
    proximo_contacto = case when p_datos ? 'proximo_contacto' then nullif(p_datos->>'proximo_contacto', '')::date else proximo_contacto end,
    actualizado_por = v_actor, updated_at = now()
  where id = p_id;
  perform public.fact_registrar('reclamo', p_id, 'actualizado', p_datos || jsonb_build_object('antes', jsonb_build_object(
    'respuesta', r.respuesta, 'promesa_fecha', r.promesa_fecha, 'promesa_importe_c', r.promesa_importe_c, 'proximo_contacto', r.proximo_contacto)), v_actor);
end $fn$;

-- Anular un reclamo cargado por error (queda el registro). Idempotente.
create or replace function public.fact_reclamo_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); r public.fact_reclamos;
begin
  if length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into r from public.fact_reclamos where id = p_id for update;
  if r.id is null then raise exception 'Reclamo inexistente'; end if;
  if r.anulado_at is not null then return; end if;
  update public.fact_reclamos set anulado_at = now(), anulado_por = v_actor, anulado_motivo = trim(p_motivo) where id = p_id;
  perform public.fact_registrar('reclamo', p_id, 'anulado', jsonb_build_object('motivo', p_motivo), v_actor);
end $fn$;

revoke all on function public.fact_reclamo_registrar(uuid, jsonb) from public, anon;
revoke all on function public.fact_reclamo_actualizar(uuid, jsonb) from public, anon;
revoke all on function public.fact_reclamo_anular(uuid, text) from public, anon;
grant execute on function public.fact_reclamo_registrar(uuid, jsonb) to authenticated;
grant execute on function public.fact_reclamo_actualizar(uuid, jsonb) to authenticated;
grant execute on function public.fact_reclamo_anular(uuid, text) to authenticated;
