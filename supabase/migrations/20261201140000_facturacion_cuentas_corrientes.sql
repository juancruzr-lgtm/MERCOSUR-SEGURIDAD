-- ═══════════════════════════════════════════════════════════════════════════
-- 20261201140000 — Facturación (3/3): cuentas corrientes, cobranzas,
-- retenciones, conciliación bancaria y tablero.
--
-- SIN APLICAR — requiere autorización expresa. Depende de 20261201120000 y 130000.
-- Rollback: supabase/rollback/20261201140000_facturacion_cuentas_corrientes_rollback.sql
--
--  · Ingreso bancario ≠ cobranza: el extracto se importa como movimientos;
--    un cobro existe sólo cuando alguien lo registra o acepta una propuesta.
--  · Aplicaciones cobro/retención → comprobante (o saldo inicial), N a N,
--    parciales. Nunca más que lo disponible ni que el saldo. No se borran:
--    se revierten con motivo.
--  · Retención 'estimada' no cancela deuda; sólo 'certificado_recibido'.
--  · Un movimiento bancario genera a lo sumo un cobro; un certificado no se
--    carga dos veces.
--  · Saldo inicial sólo con documento de respaldo.
--  · Tablero: prestación / emisión / cobro separados; abonos fuera del
--    promedio por hora; sin rentabilidad (no hay costos completos).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.fact_saldos_iniciales (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.fact_clientes(id),
  fecha          date not null,
  importe_c      bigint not null check (importe_c > 0),
  detalle        text not null check (length(trim(detalle)) > 3),
  documento_id   uuid not null references public.fact_documentos(id),
  estado         text not null default 'vigente' check (estado in ('vigente', 'anulado')),
  creado_por     uuid references public.usuarios(id) on delete set null,
  created_at     timestamptz not null default now(),
  anulado_por    uuid references public.usuarios(id) on delete set null,
  anulado_at     timestamptz,
  anulado_motivo text
);

create table if not exists public.fact_movimientos_bancarios (
  id                    uuid primary key default gen_random_uuid(),
  cuenta                text not null,
  fecha                 date not null,
  importe_c             bigint not null check (importe_c <> 0),
  concepto              text not null default '',
  referencia            text,
  cuit_contraparte      text,
  nombre_contraparte    text,
  hash_linea            text not null,
  importacion_id        uuid references public.fact_importaciones(id),
  clasificacion         text not null default 'sin_clasificar' check (clasificacion in ('sin_clasificar', 'cobranza_posible', 'no_cobranza', 'debito')),
  clasificacion_motivo  text,
  clasificado_por       uuid references public.usuarios(id) on delete set null, -- null = automática
  created_at            timestamptz not null default now(),
  unique (cuenta, hash_linea)
);
create index if not exists ix_fact_mov_fecha on public.fact_movimientos_bancarios (fecha);

create table if not exists public.fact_cobros (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.fact_clientes(id),
  fecha              date not null,
  importe_c          bigint not null check (importe_c > 0),
  medio              text not null check (medio in ('transferencia', 'deposito', 'cheque', 'echeq', 'efectivo', 'otro')),
  referencia         text,
  movimiento_id      uuid references public.fact_movimientos_bancarios(id),
  es_anticipo        boolean not null default false,
  cheque_numero      text,
  cheque_banco       text,
  cheque_fecha_pago  date,
  cheque_estado      text check (cheque_estado in ('en_cartera', 'depositado', 'acreditado', 'rechazado', 'endosado', 'anulado')),
  documento_id       uuid references public.fact_documentos(id),
  notas              text,
  creado_por         uuid references public.usuarios(id) on delete set null,
  created_at         timestamptz not null default now(),
  anulado_por        uuid references public.usuarios(id) on delete set null,
  anulado_at         timestamptz,
  anulado_motivo     text,
  check ((medio in ('cheque', 'echeq')) = (cheque_estado is not null))
);
create unique index if not exists ux_fact_cobro_movimiento on public.fact_cobros (movimiento_id) where movimiento_id is not null and anulado_at is null;
create index if not exists ix_fact_cobros_cliente on public.fact_cobros (cliente_id, fecha);

create table if not exists public.fact_retenciones (
  id                     uuid primary key default gen_random_uuid(),
  cliente_id             uuid not null references public.fact_clientes(id),
  impuesto               text not null check (impuesto in ('ganancias', 'iva', 'iibb', 'suss', 'otro')),
  certificado            text,
  fecha                  date not null,
  importe_c              bigint not null check (importe_c > 0),
  orden_pago             text,
  comprobante_citado_id  uuid references public.fact_comprobantes(id),
  documento_id           uuid references public.fact_documentos(id),
  estado                 text not null check (estado in ('estimada', 'certificado_recibido', 'anulada')),
  notas                  text,
  creado_por             uuid references public.usuarios(id) on delete set null,
  created_at             timestamptz not null default now(),
  anulado_por            uuid references public.usuarios(id) on delete set null,
  anulado_at             timestamptz,
  check (estado <> 'certificado_recibido' or certificado is not null)
);
create unique index if not exists ux_fact_retencion_certificado on public.fact_retenciones (cliente_id, impuesto, certificado) where estado = 'certificado_recibido';

create table if not exists public.fact_propuestas (
  id               uuid primary key default gen_random_uuid(),
  movimiento_id    uuid not null references public.fact_movimientos_bancarios(id),
  cliente_id       uuid references public.fact_clientes(id),
  fuerza           text not null check (fuerza in ('fuerte', 'media', 'debil')),
  aplicaciones     jsonb not null default '[]'::jsonb,
  motivos          jsonb not null default '[]'::jsonb,
  advertencias     jsonb not null default '[]'::jsonb,
  estado           text not null default 'propuesta' check (estado in ('propuesta', 'aceptada', 'rechazada', 'obsoleta')),
  generada_at      timestamptz not null default now(),
  revisado_por     uuid references public.usuarios(id) on delete set null,
  revisado_at      timestamptz,
  motivo_rechazo   text
);
create index if not exists ix_fact_propuestas_mov on public.fact_propuestas (movimiento_id, estado);

create table if not exists public.fact_aplicaciones (
  id               uuid primary key default gen_random_uuid(),
  cobro_id         uuid references public.fact_cobros(id),
  retencion_id     uuid references public.fact_retenciones(id),
  comprobante_id   uuid references public.fact_comprobantes(id),
  saldo_inicial_id uuid references public.fact_saldos_iniciales(id),
  importe_c        bigint not null check (importe_c > 0),
  vinculo          text not null default 'manual' check (vinculo in ('citado', 'inferido', 'manual')),
  propuesta_id     uuid references public.fact_propuestas(id),
  evidencia        jsonb not null default '{}'::jsonb,
  creado_por       uuid references public.usuarios(id) on delete set null,
  created_at       timestamptz not null default now(),
  revertida_por    uuid references public.usuarios(id) on delete set null,
  revertida_at     timestamptz,
  revertida_motivo text,
  check ((cobro_id is not null)::int + (retencion_id is not null)::int = 1),
  check ((comprobante_id is not null)::int + (saldo_inicial_id is not null)::int = 1)
);
create unique index if not exists ux_fact_aplicacion_vigente on public.fact_aplicaciones
  (coalesce(cobro_id, retencion_id), coalesce(comprobante_id, saldo_inicial_id)) where revertida_at is null;
create index if not exists ix_fact_aplic_comp on public.fact_aplicaciones (comprobante_id) where revertida_at is null;

do $do$
declare t text;
begin
  foreach t in array array['fact_saldos_iniciales', 'fact_movimientos_bancarios', 'fact_cobros', 'fact_retenciones', 'fact_propuestas', 'fact_aplicaciones']
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

-- ── Saldos ─────────────────────────────────────────────────────────────────
create or replace view public.fact_v_saldos with (security_invoker = true) as
select c.id as comprobante_id, c.cliente_id, c.tipo, c.punto_venta, c.numero, c.fecha_emision, c.vto_pago, c.total_c,
       coalesce(nc.t, 0) as nc_c, coalesce(nd.t, 0) as nd_c, coalesce(ap.t, 0) as aplicado_c,
       c.total_c + coalesce(nd.t, 0) - coalesce(nc.t, 0) - coalesce(ap.t, 0) as saldo_c
from public.fact_comprobantes c
left join lateral (select sum(n.total_c) t from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (3, 8, 203) and n.ambiente = 'produccion') nc on true
left join lateral (select sum(n.total_c) t from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (2, 7, 202) and n.ambiente = 'produccion') nd on true
left join lateral (select sum(a.importe_c) t from public.fact_aplicaciones a where a.comprobante_id = c.id and a.revertida_at is null) ap on true
where c.ambiente = 'produccion' and (c.tipo in (1, 6, 201) or (c.tipo in (2, 7, 202) and c.asociado_id is null));
revoke all on public.fact_v_saldos from public, anon;
grant select on public.fact_v_saldos to authenticated;

create or replace function public.fact_saldo_destino(p_comprobante_id uuid, p_saldo_inicial_id uuid)
returns bigint language sql stable security definer set search_path = public, pg_catalog as $fn$
  select case when p_comprobante_id is not null then
      public.fact_saldo_fiscal(p_comprobante_id)
      - coalesce((select sum(importe_c) from public.fact_aplicaciones where comprobante_id = p_comprobante_id and revertida_at is null), 0)
    else
      (select importe_c from public.fact_saldos_iniciales where id = p_saldo_inicial_id and estado = 'vigente')
      - coalesce((select sum(importe_c) from public.fact_aplicaciones where saldo_inicial_id = p_saldo_inicial_id and revertida_at is null), 0)
  end
$fn$;
revoke all on function public.fact_saldo_destino(uuid, uuid) from public, anon, authenticated;

-- ── Aplicación (núcleo; valida todo y bloquea filas) ───────────────────────
create or replace function public.fact_aplicar_interno(p_actor uuid, p_origen_tipo text, p_origen_id uuid, p_comprobante_id uuid,
  p_saldo_inicial_id uuid, p_importe bigint, p_vinculo text, p_evidencia jsonb, p_propuesta_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_cli_origen uuid; v_disp bigint; v_cli_dest uuid; v_saldo bigint; v_id uuid; v_estado text; v_cheque text; v_tipo int; v_amb text;
begin
  if p_importe is null or p_importe <= 0 then raise exception 'El importe a aplicar debe ser positivo'; end if;
  if p_origen_tipo = 'cobro' then
    select cliente_id, cheque_estado into v_cli_origen, v_cheque from public.fact_cobros where id = p_origen_id and anulado_at is null for update;
    if v_cli_origen is null then raise exception 'Cobro inexistente o anulado'; end if;
    if v_cheque in ('rechazado', 'anulado', 'endosado') then raise exception 'El cheque está %: no se aplica', v_cheque; end if;
    select importe_c - coalesce((select sum(importe_c) from public.fact_aplicaciones where cobro_id = p_origen_id and revertida_at is null), 0)
      into v_disp from public.fact_cobros where id = p_origen_id;
  elsif p_origen_tipo = 'retencion' then
    select cliente_id, estado into v_cli_origen, v_estado from public.fact_retenciones where id = p_origen_id for update;
    if v_cli_origen is null then raise exception 'Retención inexistente'; end if;
    if v_estado <> 'certificado_recibido' then raise exception 'Una retención sin certificado recibido no cancela deuda'; end if;
    select importe_c - coalesce((select sum(importe_c) from public.fact_aplicaciones where retencion_id = p_origen_id and revertida_at is null), 0)
      into v_disp from public.fact_retenciones where id = p_origen_id;
  else
    raise exception 'Origen inválido: %', p_origen_tipo;
  end if;
  if p_comprobante_id is not null then
    select cliente_id, tipo, ambiente into v_cli_dest, v_tipo, v_amb from public.fact_comprobantes where id = p_comprobante_id for update;
    if v_amb is distinct from 'produccion' then raise exception 'Sólo se aplica a comprobantes reales (producción)'; end if;
    if v_tipo in (3, 8, 203) then raise exception 'No se aplican cobros a una nota de crédito'; end if;
  else
    select cliente_id into v_cli_dest from public.fact_saldos_iniciales where id = p_saldo_inicial_id and estado = 'vigente' for update;
  end if;
  if v_cli_dest is null then raise exception 'El destino no existe o no tiene cliente asociado'; end if;
  if v_cli_dest <> v_cli_origen then raise exception 'El cobro y el comprobante son de clientes distintos'; end if;
  if exists (select 1 from public.fact_aplicaciones a where a.revertida_at is null
             and coalesce(a.cobro_id, a.retencion_id) = p_origen_id and coalesce(a.comprobante_id, a.saldo_inicial_id) = coalesce(p_comprobante_id, p_saldo_inicial_id)) then
    raise exception 'Ese % ya está aplicado a este comprobante', p_origen_tipo;
  end if;
  if p_importe > v_disp then raise exception 'Supera lo disponible del % (%)', p_origen_tipo, v_disp; end if;
  v_saldo := public.fact_saldo_destino(p_comprobante_id, p_saldo_inicial_id);
  if p_importe > v_saldo then raise exception 'Supera el saldo del comprobante (%)', v_saldo; end if;
  insert into public.fact_aplicaciones (cobro_id, retencion_id, comprobante_id, saldo_inicial_id, importe_c, vinculo, propuesta_id, evidencia, creado_por)
  values (case when p_origen_tipo = 'cobro' then p_origen_id end, case when p_origen_tipo = 'retencion' then p_origen_id end,
    p_comprobante_id, p_saldo_inicial_id, p_importe, coalesce(p_vinculo, 'manual'), p_propuesta_id, coalesce(p_evidencia, '{}'::jsonb), p_actor)
  returning id into v_id;
  insert into public.fact_historial (entidad, entidad_id, accion, datos, por)
  values ('aplicacion', v_id, 'alta', jsonb_build_object('origen', p_origen_tipo, 'origen_id', p_origen_id, 'comprobante_id', p_comprobante_id,
    'saldo_inicial_id', p_saldo_inicial_id, 'importe_c', p_importe, 'vinculo', p_vinculo, 'propuesta_id', p_propuesta_id), p_actor);
  return v_id;
end $fn$;
revoke all on function public.fact_aplicar_interno(uuid, text, uuid, uuid, uuid, bigint, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.fact_aplicar(p_origen_tipo text, p_origen_id uuid, p_comprobante_id uuid, p_saldo_inicial_id uuid,
  p_importe_c bigint, p_evidencia jsonb default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  return public.fact_aplicar_interno(v_actor, p_origen_tipo, p_origen_id, p_comprobante_id, p_saldo_inicial_id, p_importe_c, 'manual', p_evidencia, null);
end $fn$;

create or replace function public.fact_aplicacion_revertir(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la reversión'; end if;
  update public.fact_aplicaciones set revertida_at = now(), revertida_por = v_actor, revertida_motivo = p_motivo where id = p_id and revertida_at is null;
  if not found then raise exception 'Aplicación inexistente o ya revertida'; end if;
  perform public.fact_registrar('aplicacion', p_id, 'revertida', jsonb_build_object('motivo', p_motivo), v_actor);
end $fn$;

-- ── Saldo inicial ──────────────────────────────────────────────────────────
create or replace function public.fact_saldo_inicial_registrar(p_cliente_id uuid, p_fecha date, p_importe_c bigint, p_detalle text, p_documento_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid;
begin
  if p_documento_id is null then raise exception 'El saldo inicial necesita documento de respaldo'; end if;
  if exists (select 1 from public.fact_saldos_iniciales where cliente_id = p_cliente_id and estado = 'vigente') then
    raise exception 'El cliente ya tiene un saldo inicial vigente; anulalo antes de cargar otro';
  end if;
  insert into public.fact_saldos_iniciales (cliente_id, fecha, importe_c, detalle, documento_id, creado_por)
  values (p_cliente_id, p_fecha, p_importe_c, p_detalle, p_documento_id, v_actor) returning id into v_id;
  perform public.fact_registrar('saldo_inicial', v_id, 'alta', jsonb_build_object('cliente_id', p_cliente_id, 'importe_c', p_importe_c, 'detalle', p_detalle), v_actor);
  return v_id;
end $fn$;

-- ── Extracto bancario ──────────────────────────────────────────────────────
-- p_filas: [{fecha, importe_c, concepto, referencia, cuit_contraparte, nombre_contraparte, hash, clasificacion, clasificacion_motivo}]
create or replace function public.fact_extracto_importar(p_cuenta text, p_nombre text, p_sha256 text, p_documento_id uuid, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; f jsonb; v_nuevos int := 0; v_rep int := 0; v_mov uuid;
begin
  select id into v_id from public.fact_importaciones where tipo = 'extracto_banco' and sha256 = lower(p_sha256) and estado <> 'descartada';
  if v_id is not null then return jsonb_build_object('id', v_id, 'duplicado', true); end if;
  insert into public.fact_importaciones (tipo, nombre_archivo, sha256, documento_id, creado_por, estado)
  values ('extracto_banco', p_nombre, lower(p_sha256), p_documento_id, v_actor, 'confirmada') returning id into v_id;
  for f in select * from jsonb_array_elements(p_filas) loop
    insert into public.fact_movimientos_bancarios (cuenta, fecha, importe_c, concepto, referencia, cuit_contraparte, nombre_contraparte, hash_linea,
      importacion_id, clasificacion, clasificacion_motivo)
    values (p_cuenta, (f->>'fecha')::date, (f->>'importe_c')::bigint, coalesce(f->>'concepto', ''), f->>'referencia',
      nullif(regexp_replace(coalesce(f->>'cuit_contraparte', ''), '\D', '', 'g'), ''), f->>'nombre_contraparte', f->>'hash', v_id,
      coalesce(f->>'clasificacion', 'sin_clasificar'), f->>'clasificacion_motivo')
    on conflict (cuenta, hash_linea) do nothing returning id into v_mov;
    if v_mov is null then v_rep := v_rep + 1; else v_nuevos := v_nuevos + 1; end if;
    v_mov := null;
  end loop;
  update public.fact_importaciones set resumen = jsonb_build_object('nuevos', v_nuevos, 'ya_importados', v_rep) where id = v_id;
  perform public.fact_registrar('importacion', v_id, 'alta', jsonb_build_object('cuenta', p_cuenta, 'nuevos', v_nuevos, 'ya_importados', v_rep), v_actor);
  return jsonb_build_object('id', v_id, 'duplicado', false, 'nuevos', v_nuevos, 'ya_importados', v_rep);
end $fn$;

create or replace function public.fact_movimiento_clasificar(p_id uuid, p_clasificacion text, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if exists (select 1 from public.fact_cobros where movimiento_id = p_id and anulado_at is null) and p_clasificacion <> 'cobranza_posible' then
    raise exception 'El movimiento ya tiene un cobro registrado: anulá el cobro primero';
  end if;
  update public.fact_movimientos_bancarios set clasificacion = p_clasificacion, clasificacion_motivo = p_motivo, clasificado_por = v_actor where id = p_id;
  if not found then raise exception 'Movimiento inexistente'; end if;
  update public.fact_propuestas set estado = 'obsoleta' where movimiento_id = p_id and estado = 'propuesta' and p_clasificacion <> 'cobranza_posible';
  perform public.fact_registrar('movimiento', p_id, 'clasificacion', jsonb_build_object('clasificacion', p_clasificacion, 'motivo', p_motivo), v_actor);
end $fn$;

-- ── Cobros, cheques y retenciones ──────────────────────────────────────────
create or replace function public.fact_cobro_registrar(p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_mov public.fact_movimientos_bancarios; v_medio text := p_datos->>'medio';
begin
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

create or replace function public.fact_cobro_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo'; end if;
  if exists (select 1 from public.fact_aplicaciones where cobro_id = p_id and revertida_at is null) then
    raise exception 'El cobro tiene aplicaciones vigentes: revertilas primero';
  end if;
  update public.fact_cobros set anulado_at = now(), anulado_por = v_actor, anulado_motivo = p_motivo where id = p_id and anulado_at is null;
  if not found then raise exception 'Cobro inexistente o ya anulado'; end if;
  perform public.fact_registrar('cobro', p_id, 'anulado', jsonb_build_object('motivo', p_motivo), v_actor);
end $fn$;

-- Cheque rechazado: revierte sus aplicaciones (queda la deuda de nuevo), con historial.
create or replace function public.fact_cheque_estado(p_cobro_id uuid, p_estado text, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_de text;
begin
  select cheque_estado into v_de from public.fact_cobros where id = p_cobro_id and anulado_at is null for update;
  if v_de is null then raise exception 'No es un cheque vigente'; end if;
  if not ((v_de = 'en_cartera' and p_estado in ('depositado', 'endosado', 'anulado'))
       or (v_de = 'depositado' and p_estado in ('acreditado', 'rechazado'))
       or (v_de = 'rechazado' and p_estado in ('en_cartera', 'anulado'))) then
    raise exception 'Cambio de estado de cheque no permitido: % → %', v_de, p_estado;
  end if;
  update public.fact_cobros set cheque_estado = p_estado where id = p_cobro_id;
  if p_estado in ('rechazado', 'anulado') then
    update public.fact_aplicaciones set revertida_at = now(), revertida_por = v_actor, revertida_motivo = 'Cheque ' || p_estado || coalesce(': ' || p_motivo, '')
    where cobro_id = p_cobro_id and revertida_at is null;
  end if;
  perform public.fact_registrar('cobro', p_cobro_id, 'cheque', jsonb_build_object('de', v_de, 'a', p_estado, 'motivo', p_motivo), v_actor);
end $fn$;

create or replace function public.fact_retencion_registrar(p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_estado text := coalesce(p_datos->>'estado', 'estimada');
begin
  if v_estado not in ('estimada', 'certificado_recibido') then raise exception 'Estado inválido'; end if;
  if v_estado = 'certificado_recibido' and exists (select 1 from public.fact_retenciones where cliente_id = (p_datos->>'cliente_id')::uuid
       and impuesto = p_datos->>'impuesto' and certificado = p_datos->>'certificado' and estado = 'certificado_recibido') then
    raise exception 'El certificado % de % ya está cargado', p_datos->>'certificado', p_datos->>'impuesto' using errcode = '23505';
  end if;
  insert into public.fact_retenciones (cliente_id, impuesto, certificado, fecha, importe_c, orden_pago, comprobante_citado_id, documento_id, estado, notas, creado_por)
  values ((p_datos->>'cliente_id')::uuid, p_datos->>'impuesto', nullif(trim(p_datos->>'certificado'), ''), (p_datos->>'fecha')::date,
    (p_datos->>'importe_c')::bigint, nullif(trim(p_datos->>'orden_pago'), ''), nullif(p_datos->>'comprobante_citado_id', '')::uuid,
    nullif(p_datos->>'documento_id', '')::uuid, v_estado, p_datos->>'notas', v_actor)
  returning id into v_id;
  perform public.fact_registrar('retencion', v_id, 'alta', p_datos, v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_retencion_certificar(p_id uuid, p_certificado text, p_importe_c bigint, p_documento_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  update public.fact_retenciones set estado = 'certificado_recibido', certificado = p_certificado, importe_c = p_importe_c,
    documento_id = coalesce(p_documento_id, documento_id)
  where id = p_id and estado = 'estimada';
  if not found then raise exception 'La retención no está estimada'; end if;
  perform public.fact_registrar('retencion', p_id, 'certificada', jsonb_build_object('certificado', p_certificado, 'importe_c', p_importe_c), v_actor);
end $fn$;

-- ── Propuestas de conciliación (calculadas en lib/facturacion/conciliacion) ─
create or replace function public.fact_propuestas_guardar(p_movimiento_id uuid, p_propuestas jsonb)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); p jsonb; v_n int := 0;
begin
  perform 1 from public.fact_movimientos_bancarios where id = p_movimiento_id for update;
  update public.fact_propuestas set estado = 'obsoleta' where movimiento_id = p_movimiento_id and estado = 'propuesta';
  for p in select * from jsonb_array_elements(p_propuestas) loop
    insert into public.fact_propuestas (movimiento_id, cliente_id, fuerza, aplicaciones, motivos, advertencias)
    values (p_movimiento_id, nullif(p->>'clienteId', '')::uuid, p->>'fuerza', coalesce(p->'aplicaciones', '[]'::jsonb),
      coalesce(p->'motivos', '[]'::jsonb), coalesce(p->'advertencias', '[]'::jsonb));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

-- Aceptar = registrar el cobro del movimiento + todas las aplicaciones, atómico.
create or replace function public.fact_propuesta_aceptar(p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); p public.fact_propuestas; m public.fact_movimientos_bancarios; v_cobro uuid; a jsonb;
begin
  select * into p from public.fact_propuestas where id = p_id for update;
  if p.id is null or p.estado <> 'propuesta' then raise exception 'La propuesta ya no está vigente'; end if;
  if p.cliente_id is null or jsonb_array_length(p.aplicaciones) = 0 then raise exception 'La propuesta no tiene aplicaciones para aceptar'; end if;
  select * into m from public.fact_movimientos_bancarios where id = p.movimiento_id for update;
  if m.clasificacion <> 'cobranza_posible' then raise exception 'El movimiento no está clasificado como cobranza'; end if;
  select id into v_cobro from public.fact_cobros where movimiento_id = m.id and anulado_at is null;
  if v_cobro is null then
    insert into public.fact_cobros (cliente_id, fecha, importe_c, medio, referencia, movimiento_id, creado_por)
    values (p.cliente_id, m.fecha, m.importe_c, 'transferencia', coalesce(m.referencia, m.concepto), m.id, v_actor) returning id into v_cobro;
  elsif (select cliente_id from public.fact_cobros where id = v_cobro) <> p.cliente_id then
    raise exception 'El movimiento ya tiene un cobro de otro cliente';
  end if;
  for a in select * from jsonb_array_elements(p.aplicaciones) loop
    perform public.fact_aplicar_interno(v_actor, a->>'origen',
      case when a->>'origen' = 'cobro' then v_cobro else (a->>'origenId')::uuid end,
      (a->>'comprobanteId')::uuid, null, (a->>'importe')::bigint, a->>'vinculo',
      jsonb_build_object('motivos', p.motivos, 'advertencias', p.advertencias, 'fuerza', p.fuerza), p.id);
  end loop;
  update public.fact_propuestas set estado = 'aceptada', revisado_por = v_actor, revisado_at = now() where id = p.id;
  update public.fact_propuestas set estado = 'obsoleta' where movimiento_id = m.id and id <> p.id and estado = 'propuesta';
  perform public.fact_registrar('movimiento', m.id, 'propuesta_aceptada', jsonb_build_object('propuesta_id', p.id, 'cobro_id', v_cobro), v_actor);
  return v_cobro;
end $fn$;

create or replace function public.fact_propuesta_rechazar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  update public.fact_propuestas set estado = 'rechazada', revisado_por = v_actor, revisado_at = now(), motivo_rechazo = p_motivo
  where id = p_id and estado = 'propuesta';
  if not found then raise exception 'La propuesta ya no está vigente'; end if;
end $fn$;

-- ── Tablero ────────────────────────────────────────────────────────────────
-- Tres ejes separados para el mismo mes: prestación (período de servicio),
-- emisión (fecha del comprobante) y cobro (fecha del cobro).
create or replace function public.fact_tablero(p_mes text, p_hoy date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v_desde date := (p_mes || '-01')::date; v_hasta date := ((p_mes || '-01')::date + interval '1 month')::date;
  v_hoy date := coalesce(p_hoy, (now() at time zone 'America/Argentina/Buenos_Aires')::date); r jsonb := '{}'::jsonb;
begin
  if not public.facturacion_puede_actual() then raise exception 'Sólo Gerencia o Administración' using errcode = '42501'; end if;

  r := r || jsonb_build_object('prestacion', (
    select jsonb_build_object(
      'horas_registradas', coalesce(sum(p.minutos_registrados), 0) / 60.0,
      'horas_aprobadas', coalesce(sum(p.minutos_aprobados), 0) / 60.0,
      'horas_pendientes_facturar', coalesce(sum(p.minutos_aprobados) filter (where p.estado <> 'emitida'), 0) / 60.0,
      'horas_sin_aprobar', coalesce(sum(p.minutos_pendientes), 0) / 60.0,
      'prefacturas', count(*),
      'pendientes', count(*) filter (where p.estado not in ('emitida')),
      'por_estado', coalesce((select jsonb_object_agg(estado, n) from (select estado, count(*) n from public.fact_prefacturas
                     where periodo_mes = p_mes and estado <> 'descartada' group by estado) s), '{}'::jsonb),
      'ajustes_neto_c', coalesce((select sum(a.importe_neto_c) from public.fact_ajustes a join public.fact_prefacturas pp on pp.id = a.prefactura_id
                     where pp.periodo_mes = p_mes and a.aprobado_at is not null and a.anulado_at is null), 0))
    from public.fact_prefacturas p where p.periodo_mes = p_mes and p.estado <> 'descartada'));

  r := r || jsonb_build_object('demoras', coalesce((
    select jsonb_agg(jsonb_build_object('prefactura_id', p.id, 'cliente', c.razon_social, 'objetivo', o.nombre, 'estado', p.estado,
      'motivos', p.requisitos, 'proxima_accion', p.proxima_accion, 'responsable_id', p.responsable_id) order by c.razon_social)
    from public.fact_prefacturas p join public.fact_clientes c on c.id = p.cliente_id left join public.objetivos o on o.id = p.objetivo_id
    where p.periodo_mes = p_mes and p.estado in ('en_preparacion', 'esperando_requisitos', 'lista_revision', 'aprobada_emitir')), '[]'::jsonb));

  r := r || jsonb_build_object('emision', (
    select jsonb_build_object(
      'facturas_neto_c', coalesce(sum(neto_c) filter (where tipo in (1, 6, 201)), 0),
      'facturas_iva_c', coalesce(sum(iva_c) filter (where tipo in (1, 6, 201)), 0),
      'facturas_total_c', coalesce(sum(total_c) filter (where tipo in (1, 6, 201)), 0),
      'nc_neto_c', coalesce(sum(neto_c) filter (where tipo in (3, 8, 203)), 0),
      'nc_total_c', coalesce(sum(total_c) filter (where tipo in (3, 8, 203)), 0),
      'nd_neto_c', coalesce(sum(neto_c) filter (where tipo in (2, 7, 202)), 0),
      'nd_total_c', coalesce(sum(total_c) filter (where tipo in (2, 7, 202)), 0),
      'neto_facturado_c', coalesce(sum(case when tipo in (3, 8, 203) then -neto_c else neto_c end), 0),
      'comprobantes', count(*))
    from public.fact_comprobantes where ambiente = 'produccion' and fecha_emision >= v_desde and fecha_emision < v_hasta));

  r := r || jsonb_build_object('cobro', jsonb_build_object(
    'cobrado_c', coalesce((select sum(importe_c) from public.fact_cobros where anulado_at is null and fecha >= v_desde and fecha < v_hasta
                   and coalesce(cheque_estado, 'acreditado') not in ('rechazado', 'anulado')), 0),
    'retenciones_certificadas_c', coalesce((select sum(importe_c) from public.fact_retenciones where estado = 'certificado_recibido' and fecha >= v_desde and fecha < v_hasta), 0),
    'retenciones_estimadas_c', coalesce((select sum(importe_c) from public.fact_retenciones where estado = 'estimada' and fecha >= v_desde and fecha < v_hasta), 0),
    'ingresos_no_cobranza_c', coalesce((select sum(importe_c) from public.fact_movimientos_bancarios where clasificacion = 'no_cobranza' and importe_c > 0 and fecha >= v_desde and fecha < v_hasta), 0)));

  r := r || jsonb_build_object('deuda', (
    select jsonb_build_object(
      'total_c', coalesce(sum(saldo_c) filter (where saldo_c > 0), 0),
      'no_vencido_c', coalesce(sum(saldo_c) filter (where saldo_c > 0 and (vto_pago is null or vto_pago >= v_hoy)), 0),
      'd1_30_c', coalesce(sum(saldo_c) filter (where saldo_c > 0 and v_hoy - vto_pago between 1 and 30), 0),
      'd31_60_c', coalesce(sum(saldo_c) filter (where saldo_c > 0 and v_hoy - vto_pago between 31 and 60), 0),
      'd61_90_c', coalesce(sum(saldo_c) filter (where saldo_c > 0 and v_hoy - vto_pago between 61 and 90), 0),
      'mas_90_c', coalesce(sum(saldo_c) filter (where saldo_c > 0 and v_hoy - vto_pago > 90), 0),
      'sin_cliente_c', coalesce(sum(saldo_c) filter (where saldo_c > 0 and cliente_id is null), 0),
      'saldos_iniciales_c', coalesce((select sum(public.fact_saldo_destino(null, s.id)) from public.fact_saldos_iniciales s where s.estado = 'vigente'), 0))
    from public.fact_v_saldos));

  r := r || jsonb_build_object('sin_aplicar', jsonb_build_object(
    'cobros_c', coalesce((select sum(c.importe_c - coalesce((select sum(a.importe_c) from public.fact_aplicaciones a where a.cobro_id = c.id and a.revertida_at is null), 0))
                  from public.fact_cobros c where c.anulado_at is null and coalesce(c.cheque_estado, 'acreditado') not in ('rechazado', 'anulado', 'endosado')), 0),
    'movimientos_sin_cobro', (select count(*) from public.fact_movimientos_bancarios m where m.clasificacion = 'cobranza_posible'
                  and not exists (select 1 from public.fact_cobros c where c.movimiento_id = m.id and c.anulado_at is null)),
    'movimientos_sin_clasificar', (select count(*) from public.fact_movimientos_bancarios m where m.clasificacion = 'sin_clasificar' and m.importe_c > 0)));

  r := r || jsonb_build_object('por_cliente', coalesce((
    select jsonb_agg(x order by x->>'cliente') from (
      select jsonb_build_object('cliente_id', c.id, 'cliente', c.razon_social,
        'facturado_neto_c', coalesce((select sum(case when k.tipo in (3, 8, 203) then -k.neto_c else k.neto_c end) from public.fact_comprobantes k
                              where k.cliente_id = c.id and k.ambiente = 'produccion' and k.fecha_emision >= v_desde and k.fecha_emision < v_hasta), 0),
        'cobrado_c', coalesce((select sum(importe_c) from public.fact_cobros k where k.cliente_id = c.id and k.anulado_at is null and k.fecha >= v_desde and k.fecha < v_hasta
                              and coalesce(k.cheque_estado, 'acreditado') not in ('rechazado', 'anulado')), 0),
        'saldo_c', coalesce((select sum(saldo_c) from public.fact_v_saldos s where s.cliente_id = c.id), 0),
        'horas_aprobadas', coalesce((select sum(minutos_aprobados) from public.fact_prefacturas p where p.cliente_id = c.id and p.periodo_mes = p_mes and p.estado <> 'descartada'), 0) / 60.0) x
      from public.fact_clientes c where c.activo) s), '[]'::jsonb));

  r := r || jsonb_build_object('por_objetivo', coalesce((
    select jsonb_agg(jsonb_build_object('objetivo_id', h.objetivo_id, 'objetivo', o.nombre,
      'horas_registradas', h.minutos_registrados / 60.0, 'horas_aprobadas', h.minutos_aprobados / 60.0) order by o.nombre)
    from public.fact_horas_aprobaciones h join public.objetivos o on o.id = h.objetivo_id
    where h.estado = 'aprobada' and h.periodo_hasta_excl > v_desde and h.periodo_desde < v_hasta), '[]'::jsonb));

  -- Precio promedio por hora: SÓLO líneas de horas (sin abonos, ajustes ni anticipos).
  r := r || jsonb_build_object('precio_hora', (
    select jsonb_build_object('neto_c', coalesce(sum((l->'importes'->>'neto')::bigint), 0),
      'horas', coalesce(sum((l->>'cantidad')::numeric), 0),
      'promedio_c', case when coalesce(sum((l->>'cantidad')::numeric), 0) > 0
                     then round(sum((l->'importes'->>'neto')::bigint) / sum((l->>'cantidad')::numeric)) end)
    from public.fact_prefacturas p cross join lateral jsonb_array_elements(p.lineas) l
    where p.periodo_mes = p_mes and p.estado <> 'descartada' and l->>'concepto' like 'Horas%'));

  r := r || jsonb_build_object('rentabilidad', jsonb_build_object('disponible', false, 'motivo', 'No hay costos completos por objetivo: no se calcula rentabilidad.'));
  return r;
end $fn$;

do $do$
declare f text;
begin
  foreach f in array array['fact_aplicar(text, uuid, uuid, uuid, bigint, jsonb)', 'fact_aplicacion_revertir(uuid, text)',
    'fact_saldo_inicial_registrar(uuid, date, bigint, text, uuid)', 'fact_extracto_importar(text, text, text, uuid, jsonb)',
    'fact_movimiento_clasificar(uuid, text, text)', 'fact_cobro_registrar(jsonb)', 'fact_cobro_anular(uuid, text)',
    'fact_cheque_estado(uuid, text, text)', 'fact_retencion_registrar(jsonb)', 'fact_retencion_certificar(uuid, text, bigint, uuid)',
    'fact_propuestas_guardar(uuid, jsonb)', 'fact_propuesta_aceptar(uuid)', 'fact_propuesta_rechazar(uuid, text)', 'fact_tablero(text, date)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$do$;

commit;
notify pgrst, 'reload schema';
