-- ═══════════════════════════════════════════════════════════════════════════
-- 20261201120000 — Facturación (1/3): clientes, contratos, tarifas, OC,
-- documentos, horas aprobadas y bandeja de prefacturación.
--
-- SIN APLICAR — requiere autorización expresa (AGENTS.md).
-- Rollback: supabase/rollback/20261201120000_facturacion_base_rollback.sql
--
-- Qué hace
--  · Clientes por CUIT + razón social, con alias (planilla/banco/documentos)
--    y contactos/destinatarios por objetivo.
--  · Contratos con modalidad, agrupación (por cliente o por objetivo), regla
--    de período (mes o corte 26→25), requisitos documentales y entrega.
--  · Tarifas con vigencia, diurna/nocturna y tratamiento de IVA EXPLÍCITO
--    ('sin_definir' no se calcula). Una tarifa no se edita: se cierra y se
--    carga la nueva.
--  · Órdenes de compra / licitaciones / presupuestos: UNA fila aunque cubra
--    varios objetivos; el consumo se registra por prefactura.
--  · Documentos con archivo original, origen, hash (duplicados) y vínculos
--    corregibles; preparado para una futura entrada por correo.
--  · Horas aprobadas para facturación: una FOTO por objetivo y período,
--    tomada de los registros de la app. No modifica turnos ni asistencias.
--  · Prefacturas: una por cliente + período + agrupación, con estados de
--    preparación separados de entrega/portal. Huella material calculada en
--    la base: si cambia después de aprobada, la aprobación cae sola.
--
-- Qué NO hace
--  · No toca turnos, registros_asistencia ni liquidación.
--  · No emite comprobantes (eso es 20261201130000 y queda deshabilitado).
--
-- Acceso: Gerencia (incluida la delegada) y Administración.
-- Toda escritura por RPC security definer; las tablas sólo admiten SELECT.
-- Importes en centavos (bigint, sufijo _c).
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── Acceso ─────────────────────────────────────────────────────────────────
create or replace function public.facturacion_puede_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.puede_acceder_gerencia_actual()
      or exists (select 1 from public.usuarios u
                 where u.auth_user_id = auth.uid() and u.estado = 'activo'
                   and u.puesto_organizacional = 'administracion')
$fn$;
revoke all on function public.facturacion_puede_actual() from public, anon;
grant execute on function public.facturacion_puede_actual() to authenticated;

create or replace function public.facturacion_actor()
returns uuid language sql stable security definer set search_path = public, pg_catalog as $fn$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() limit 1
$fn$;
revoke all on function public.facturacion_actor() from public, anon, authenticated;

create or replace function public.facturacion_gate()
returns uuid language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v uuid;
begin
  if auth.uid() is null or not public.facturacion_puede_actual() then
    raise exception 'Sólo Gerencia o Administración' using errcode = '42501';
  end if;
  v := public.facturacion_actor();
  if v is null then raise exception 'Usuario no encontrado' using errcode = '42501'; end if;
  return v;
end $fn$;
revoke all on function public.facturacion_gate() from public, anon, authenticated;

create or replace function public.fact_cuit_valido(p text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $fn$
declare c text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); pesos int[] := array[5,4,3,2,7,6,5,4,3,2]; s int := 0; dv int;
begin
  if length(c) <> 11 then return false; end if;
  for i in 1..10 loop s := s + pesos[i] * substr(c, i, 1)::int; end loop;
  dv := 11 - (s % 11);
  if dv = 11 then dv := 0; end if;
  if dv = 10 then return false; end if;
  return dv = substr(c, 11, 1)::int;
end $fn$;

-- ── Historial único (append-only) ──────────────────────────────────────────
create table if not exists public.fact_historial (
  id         bigserial primary key,
  entidad    text not null,
  entidad_id uuid not null,
  accion     text not null,
  datos      jsonb not null default '{}'::jsonb,
  por        uuid references public.usuarios(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists ix_fact_historial_entidad on public.fact_historial (entidad, entidad_id, at desc);

create or replace function public.fact_historial_inmutable()
returns trigger language plpgsql as $fn$
begin raise exception 'El historial de facturación no se modifica ni se borra' using errcode = '42501'; end $fn$;
drop trigger if exists fact_historial_inmutable on public.fact_historial;
create trigger fact_historial_inmutable before update or delete on public.fact_historial
  for each row execute function public.fact_historial_inmutable();
drop trigger if exists fact_historial_inmutable_trunc on public.fact_historial;
create trigger fact_historial_inmutable_trunc before truncate on public.fact_historial
  for each statement execute function public.fact_historial_inmutable();

create or replace function public.fact_registrar(p_entidad text, p_id uuid, p_accion text, p_datos jsonb, p_por uuid)
returns void language sql security definer set search_path = public, pg_catalog as $fn$
  insert into public.fact_historial (entidad, entidad_id, accion, datos, por) values (p_entidad, p_id, p_accion, coalesce(p_datos, '{}'::jsonb), p_por)
$fn$;
revoke all on function public.fact_registrar(text, uuid, text, jsonb, uuid) from public, anon, authenticated;

-- ── Clientes ───────────────────────────────────────────────────────────────
create table if not exists public.fact_clientes (
  id                     uuid primary key default gen_random_uuid(),
  cuit                   text check (cuit is null or (cuit ~ '^\d{11}$' and public.fact_cuit_valido(cuit))),
  razon_social           text not null check (length(trim(razon_social)) > 1),
  -- Sin valor por defecto: la condición del receptor es obligatoria en WSFEv1 (RG 5616) y no se supone.
  condicion_iva          text
                           check (condicion_iva in ('responsable_inscripto', 'exento', 'consumidor_final', 'monotributo', 'sujeto_no_categorizado')),
  tipo_comprobante       integer check (tipo_comprobante in (1, 6, 201)),
  -- Domicilio del receptor: va impreso en el comprobante.
  domicilio              text,
  notas                  text,
  activo                 boolean not null default true,
  version                integer not null default 1,
  creado_por             uuid references public.usuarios(id) on delete set null,
  actualizado_por        uuid references public.usuarios(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists ux_fact_clientes_cuit on public.fact_clientes (cuit) where cuit is not null;

create table if not exists public.fact_cliente_alias (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.fact_clientes(id),
  alias       text not null check (length(trim(alias)) > 1),
  origen      text not null check (origen in ('planilla', 'banco', 'documento', 'arca', 'otro')),
  -- false = equivalencia propuesta sin confirmar (p. ej. «Club Unidos» → Universitario)
  confirmado  boolean not null default false,
  nota        text,
  creado_por  uuid references public.usuarios(id) on delete set null,
  created_at  timestamptz not null default now(),
  anulado_at  timestamptz,
  anulado_por uuid references public.usuarios(id) on delete set null
);
create unique index if not exists ux_fact_alias_vigente on public.fact_cliente_alias (lower(trim(alias))) where anulado_at is null;

create table if not exists public.fact_contactos (
  id                      uuid primary key default gen_random_uuid(),
  cliente_id              uuid not null references public.fact_clientes(id),
  objetivo_id             uuid references public.objetivos(id),
  nombre                  text not null,
  email                   text,
  telefono                text,
  rol                     text not null check (rol in ('destinatario_factura', 'autorizado_conformidad', 'pagos', 'otro')),
  activo                  boolean not null default true,
  notas                   text,
  creado_por              uuid references public.usuarios(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists ix_fact_contactos_cliente on public.fact_contactos (cliente_id, objetivo_id);

-- ── Contratos y tarifas ────────────────────────────────────────────────────
create table if not exists public.fact_contratos (
  id                       uuid primary key default gen_random_uuid(),
  cliente_id               uuid not null references public.fact_clientes(id),
  nombre                   text not null,
  modalidad                text not null check (modalidad in ('por_hora', 'abono', 'presupuesto_anticipado', 'orden_compra')),
  agrupacion               text not null default 'cliente' check (agrupacion in ('cliente', 'objetivo')),
  regla_periodo            text not null default 'mes_calendario' check (regla_periodo in ('mes_calendario', 'corte')),
  dia_corte                integer check (dia_corte between 2 and 28),
  separar_diurna_nocturna  boolean not null default false,
  -- Superposición de turnos del mismo puesto (relevos): 'unir' = se factura una vez.
  superposicion            text not null default 'unir' check (superposicion in ('unir', 'sumar')),
  -- Franja CONTRACTUAL (no la salarial). Null = sin definir → requisito pendiente.
  franja_nocturna_desde    time,
  franja_nocturna_hasta    time,
  dias_vencimiento         integer check (dias_vencimiento between 0 and 365),
  requisitos               text[] not null default '{}'
                             check (requisitos <@ array['oc_mensual', 'oc_vigente', 'conformidad', 'presupuesto_aceptado']::text[]),
  canal_entrega            text not null default 'email' check (canal_entrega in ('email', 'portal', 'papel')),
  envio_conjunto_planilla  boolean not null default false,
  requiere_portal          boolean not null default false,
  tipo_comprobante         integer check (tipo_comprobante in (1, 6, 201)),
  pendientes_comerciales   text[] not null default '{}',
  vigencia_desde           date,
  vigencia_hasta           date,
  estado                   text not null default 'borrador' check (estado in ('borrador', 'vigente', 'finalizado')),
  notas                    text,
  version                  integer not null default 1,
  creado_por               uuid references public.usuarios(id) on delete set null,
  actualizado_por          uuid references public.usuarios(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (regla_periodo <> 'corte' or dia_corte is not null),
  check (vigencia_hasta is null or vigencia_desde is null or vigencia_hasta >= vigencia_desde)
);
create index if not exists ix_fact_contratos_cliente on public.fact_contratos (cliente_id);

create table if not exists public.fact_contrato_objetivos (
  id           uuid primary key default gen_random_uuid(),
  contrato_id  uuid not null references public.fact_contratos(id),
  objetivo_id  uuid not null references public.objetivos(id),
  desde        date,
  hasta        date,
  creado_por   uuid references public.usuarios(id) on delete set null,
  created_at   timestamptz not null default now(),
  anulado_at   timestamptz,
  unique (contrato_id, objetivo_id)
);
create index if not exists ix_fact_contrato_objetivos_obj on public.fact_contrato_objetivos (objetivo_id);

create table if not exists public.fact_tarifas (
  id               uuid primary key default gen_random_uuid(),
  contrato_id      uuid not null references public.fact_contratos(id),
  objetivo_id      uuid references public.objetivos(id),
  concepto         text not null check (concepto in ('hora', 'hora_diurna', 'hora_nocturna', 'abono')),
  precio           numeric(20, 6) not null check (precio > 0),
  tratamiento_iva  text not null check (tratamiento_iva in ('adicional', 'incluido', 'exento', 'sin_definir')),
  alicuota_iva     numeric(5, 2) not null default 21 check (alicuota_iva in (0, 10.5, 21, 27)),
  vigencia_desde   date not null,
  vigencia_hasta   date,
  motivo           text,
  creado_por       uuid references public.usuarios(id) on delete set null,
  created_at       timestamptz not null default now(),
  cerrada_por      uuid references public.usuarios(id) on delete set null,
  cerrada_at       timestamptz,
  check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
create index if not exists ix_fact_tarifas_contrato on public.fact_tarifas (contrato_id, concepto, vigencia_desde);

-- ── Documentos (antes que OC y prefacturas, que los referencian) ───────────
create table if not exists public.fact_documentos (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null check (tipo in ('orden_compra', 'conformidad', 'presupuesto', 'orden_pago',
                         'certificado_retencion', 'presentacion', 'planilla', 'factura', 'extracto', 'otro')),
  storage_bucket      text not null default 'facturacion-documentos',
  storage_path        text not null,
  nombre_original     text not null,
  mime                text,
  bytes               bigint check (bytes is null or bytes >= 0),
  sha256              text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Entrada: hoy 'carga_manual'; 'correo' queda listo para la casilla de facturación.
  origen              text not null default 'carga_manual' check (origen in ('carga_manual', 'correo', 'importacion', 'generado_app')),
  origen_ref          text,       -- p. ej. Message-ID del correo
  remitente           text,
  asunto              text,
  recibido_at         timestamptz,
  cliente_id          uuid references public.fact_clientes(id),
  -- Lo que una extracción (o IA) propone: NUNCA se toma como confirmado.
  datos_propuestos    jsonb,
  datos_confirmados   jsonb,
  estado              text not null default 'pendiente_revision' check (estado in ('pendiente_revision', 'confirmado', 'descartado')),
  cargado_por         uuid references public.usuarios(id) on delete set null,
  created_at          timestamptz not null default now(),
  revisado_por        uuid references public.usuarios(id) on delete set null,
  revisado_at         timestamptz
);
create unique index if not exists ux_fact_documentos_sha on public.fact_documentos (sha256) where estado <> 'descartado';
create unique index if not exists ux_fact_documentos_ruta on public.fact_documentos (storage_bucket, storage_path);

create table if not exists public.fact_documento_vinculos (
  id            uuid primary key default gen_random_uuid(),
  documento_id  uuid not null references public.fact_documentos(id),
  entidad       text not null check (entidad in ('cliente', 'objetivo', 'contrato', 'orden_compra', 'prefactura', 'comprobante', 'cobro', 'retencion', 'movimiento')),
  entidad_id    uuid not null,
  creado_por    uuid references public.usuarios(id) on delete set null,
  created_at    timestamptz not null default now(),
  anulado_at    timestamptz,
  anulado_por   uuid references public.usuarios(id) on delete set null,
  anulado_motivo text
);
create unique index if not exists ux_fact_doc_vinculo_vigente on public.fact_documento_vinculos (documento_id, entidad, entidad_id) where anulado_at is null;
create index if not exists ix_fact_doc_vinculo_entidad on public.fact_documento_vinculos (entidad, entidad_id) where anulado_at is null;

-- ── Órdenes de compra / licitaciones / presupuestos ────────────────────────
create table if not exists public.fact_ordenes_compra (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.fact_clientes(id),
  tipo            text not null default 'orden_compra' check (tipo in ('orden_compra', 'licitacion', 'presupuesto')),
  numero          text not null,
  fecha           date,
  vigencia_desde  date,
  vigencia_hasta  date,
  monto_neto_c    bigint check (monto_neto_c is null or monto_neto_c > 0),
  -- Monto CON IVA, como lo expresan casi todas las OC reales (ACA 0006-26 = 8.760 h × $14.641;
  -- Depósito Fiscal = 12 × $14.235.000). Si está, el saldo se mide contra el total facturado.
  monto_total_c   bigint check (monto_total_c is null or monto_total_c > 0),
  horas           numeric(12, 2) check (horas is null or horas > 0),
  -- Presupuesto aceptado (INTA): fecha y documento de aceptación.
  aceptado_at     date,
  condiciones     text,
  documento_id    uuid references public.fact_documentos(id),
  estado          text not null default 'vigente' check (estado in ('vigente', 'cerrada', 'anulada')),
  version         integer not null default 1,
  creado_por      uuid references public.usuarios(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (cliente_id, tipo, numero),
  check (monto_neto_c is null or monto_total_c is null),
  check (vigencia_hasta is null or vigencia_desde is null or vigencia_hasta >= vigencia_desde)
);

create table if not exists public.fact_oc_objetivos (
  oc_id        uuid not null references public.fact_ordenes_compra(id),
  objetivo_id  uuid not null references public.objetivos(id),
  primary key (oc_id, objetivo_id)
);

-- ── Horas aprobadas para facturación (foto, no toca la operación) ──────────
create table if not exists public.fact_horas_aprobaciones (
  id                    uuid primary key default gen_random_uuid(),
  objetivo_id           uuid not null references public.objetivos(id),
  contrato_id           uuid references public.fact_contratos(id),
  periodo_desde         date not null,
  periodo_hasta_excl    date not null check (periodo_hasta_excl > periodo_desde),
  -- Horas FACTURABLES (no las liquidables del vigilador): programado y cubierto
  -- por puesto, con la superposición de relevos contada una sola vez.
  minutos_programados   integer not null check (minutos_programados >= 0),
  minutos_cubiertos     integer not null check (minutos_cubiertos >= 0),
  minutos_superpuestos  integer not null default 0 check (minutos_superpuestos >= 0),
  minutos_descubiertos  integer not null default 0 check (minutos_descubiertos >= 0),
  minutos_aprobados     integer not null check (minutos_aprobados >= 0),
  minutos_diurnos       integer check (minutos_diurnos >= 0),
  minutos_nocturnos     integer check (minutos_nocturnos >= 0),
  regla_superposicion   text not null default 'unir' check (regla_superposicion in ('unir', 'sumar')),
  -- Decisión comercial de Administración sobre lo descubierto (no toca registros).
  tratamiento_descubiertos text not null default 'no_facturar' check (tratamiento_descubiertos in ('no_facturar', 'facturar')),
  -- Detalle verificable: [{turno_id, registro_id, puesto_id, programados, cubiertos, estado}]
  detalle               jsonb not null default '[]'::jsonb,
  notas                 text,
  check (minutos_aprobados = minutos_cubiertos + case when tratamiento_descubiertos = 'facturar' then minutos_descubiertos else 0 end),
  check (tratamiento_descubiertos = 'no_facturar' or length(trim(coalesce(notas, ''))) > 3),
  estado                text not null default 'aprobada' check (estado in ('aprobada', 'anulada')),
  aprobado_por          uuid references public.usuarios(id) on delete set null,
  aprobado_at           timestamptz not null default now(),
  anulado_por           uuid references public.usuarios(id) on delete set null,
  anulado_at            timestamptz,
  anulado_motivo        text,
  check (minutos_diurnos is null or minutos_nocturnos is null or minutos_diurnos + minutos_nocturnos = minutos_aprobados)
);
create unique index if not exists ux_fact_horas_vigente on public.fact_horas_aprobaciones (objetivo_id, periodo_desde, periodo_hasta_excl) where estado = 'aprobada';

-- ── Prefacturas ────────────────────────────────────────────────────────────
create table if not exists public.fact_prefacturas (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references public.fact_clientes(id),
  contrato_id          uuid references public.fact_contratos(id),
  -- 'cliente' o el id del objetivo cuando el contrato factura por objetivo (Laromet)
  agrupacion_clave     text not null,
  objetivo_id          uuid references public.objetivos(id),
  periodo_mes          text not null check (periodo_mes ~ '^\d{4}-\d{2}$'),
  periodo_desde        date not null,
  periodo_hasta_excl   date not null check (periodo_hasta_excl > periodo_desde),
  estado               text not null default 'en_preparacion'
                         check (estado in ('en_preparacion', 'esperando_requisitos', 'lista_revision', 'aprobada_emitir', 'emitida', 'descartada')),
  estado_entrega       text not null default 'pendiente' check (estado_entrega in ('pendiente', 'enviada', 'no_requiere')),
  estado_portal        text not null default 'no_requiere' check (estado_portal in ('no_requiere', 'pendiente', 'presentada', 'observada', 'aceptada')),
  responsable_id       uuid references public.usuarios(id) on delete set null,
  proxima_accion       text,
  proxima_accion_fecha date,
  horas_aprobacion_ids uuid[] not null default '{}',
  minutos_programados  integer,
  minutos_cubiertos    integer,
  minutos_aprobados    integer,
  minutos_descubiertos integer,
  lineas              jsonb not null default '[]'::jsonb,
  neto_c               bigint,
  iva_c                bigint,
  total_c              bigint,
  requisitos           jsonb not null default '[]'::jsonb,
  avisos               jsonb not null default '[]'::jsonb,
  texto_factura        text,
  cuit_receptor        text,
  tipo_comprobante     integer check (tipo_comprobante in (1, 6, 201)),
  punto_venta          integer check (punto_venta between 1 and 99998),
  fecha_vencimiento    date,
  oc_id                uuid references public.fact_ordenes_compra(id),
  -- Factura anticipada que cubre este período (INTA)
  anticipo_prefactura_id uuid references public.fact_prefacturas(id),
  huella               text,
  huella_aprobada      text,
  aprobada_por         uuid references public.usuarios(id) on delete set null,
  aprobada_at          timestamptz,
  version              integer not null default 1,
  creado_por           uuid references public.usuarios(id) on delete set null,
  actualizado_por      uuid references public.usuarios(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (neto_c is null or (iva_c is not null and total_c = neto_c + iva_c)),
  check (estado <> 'aprobada_emitir' or (total_c is not null and huella_aprobada is not null))
);
-- Una sola prefactura viva por prestación: evita facturar dos veces lo mismo.
create unique index if not exists ux_fact_prefactura_prestacion on public.fact_prefacturas (cliente_id, agrupacion_clave, periodo_desde, periodo_hasta_excl)
  where estado <> 'descartada';
create index if not exists ix_fact_prefacturas_periodo on public.fact_prefacturas (periodo_mes, estado);

create or replace function public.fact_prefactura_huella(p public.fact_prefacturas)
returns text language sql immutable set search_path = public, pg_catalog as $fn$
  select md5(jsonb_build_array(
    -- El punto de venta es del canal de emisión (fact_config), no del contenido aprobado.
    coalesce(p.cuit_receptor, ''), coalesce(p.tipo_comprobante, 0),
    p.periodo_desde, p.periodo_hasta_excl, p.lineas, p.neto_c, p.iva_c, p.total_c,
    regexp_replace(trim(coalesce(p.texto_factura, '')), '\s+', ' ', 'g'), p.fecha_vencimiento, p.oc_id
  )::text)
$fn$;

-- Cambio material después de aprobada → vuelve a revisión, sin excepción.
create or replace function public.fact_prefactura_antes_guardar()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  new.huella := public.fact_prefactura_huella(new);
  if tg_op = 'UPDATE' then
    if old.estado = 'emitida' and (new.huella is distinct from old.huella or new.estado <> 'emitida') then
      raise exception 'Una prefactura emitida no se modifica: corregir con nota de crédito/débito' using errcode = '42501';
    end if;
    if new.estado = 'aprobada_emitir' and new.huella is distinct from new.huella_aprobada then
      new.estado := 'lista_revision';
      new.huella_aprobada := null; new.aprobada_por := null; new.aprobada_at := null;
      insert into public.fact_historial (entidad, entidad_id, accion, datos, por)
      values ('prefactura', new.id, 'aprobacion_caida', jsonb_build_object('motivo', 'cambio material después de aprobada'), new.actualizado_por);
    end if;
    new.updated_at := now();
  end if;
  return new;
end $fn$;
drop trigger if exists fact_prefactura_antes_guardar on public.fact_prefacturas;
create trigger fact_prefactura_antes_guardar before insert or update on public.fact_prefacturas
  for each row execute function public.fact_prefactura_antes_guardar();

create table if not exists public.fact_oc_consumos (
  id             uuid primary key default gen_random_uuid(),
  oc_id          uuid not null references public.fact_ordenes_compra(id),
  prefactura_id  uuid not null references public.fact_prefacturas(id),
  neto_c         bigint not null check (neto_c >= 0),
  total_c        bigint not null default 0 check (total_c >= 0),
  horas          numeric(12, 2) not null default 0,
  created_at     timestamptz not null default now(),
  anulado_at     timestamptz
);
create unique index if not exists ux_fact_oc_consumo_vigente on public.fact_oc_consumos (oc_id, prefactura_id) where anulado_at is null;

create table if not exists public.fact_ajustes (
  id              uuid primary key default gen_random_uuid(),
  prefactura_id   uuid not null references public.fact_prefacturas(id),
  descripcion     text not null,
  importe_neto_c  bigint not null check (importe_neto_c <> 0),
  motivo          text not null check (length(trim(motivo)) > 2),
  creado_por      uuid references public.usuarios(id) on delete set null,
  created_at      timestamptz not null default now(),
  aprobado_por    uuid references public.usuarios(id) on delete set null,
  aprobado_at     timestamptz,
  anulado_por     uuid references public.usuarios(id) on delete set null,
  anulado_at      timestamptz,
  anulado_motivo  text
);
create index if not exists ix_fact_ajustes_pref on public.fact_ajustes (prefactura_id);

-- Envíos (planilla, factura): un registro por envío, sin importar quién lo hizo.
create table if not exists public.fact_envios (
  id                uuid primary key default gen_random_uuid(),
  prefactura_id     uuid not null references public.fact_prefacturas(id),
  tipo              text not null check (tipo in ('planilla', 'factura', 'factura_y_planilla', 'documentacion')),
  version_planilla  text,
  enviado_por       uuid not null references public.usuarios(id),
  destinatarios     text[] not null check (cardinality(destinatarios) > 0),
  canal             text not null default 'email' check (canal in ('email', 'portal', 'papel', 'whatsapp', 'otro')),
  enviado_at        timestamptz not null,
  documento_id      uuid references public.fact_documentos(id),
  notas             text,
  registrado_por    uuid references public.usuarios(id) on delete set null,
  created_at        timestamptz not null default now(),
  anulado_at        timestamptz,
  anulado_motivo    text
);
create index if not exists ix_fact_envios_pref on public.fact_envios (prefactura_id, enviado_at);

-- Conformidad / correcciones del cliente sobre una versión de la planilla.
create table if not exists public.fact_conformidades (
  id                uuid primary key default gen_random_uuid(),
  prefactura_id     uuid not null references public.fact_prefacturas(id),
  tipo              text not null check (tipo in ('conformidad', 'correcciones')),
  contacto_id       uuid references public.fact_contactos(id),
  version_planilla  text,
  documento_id      uuid references public.fact_documentos(id),
  texto             text,
  recibido_at       timestamptz not null,
  registrado_por    uuid references public.usuarios(id) on delete set null,
  created_at        timestamptz not null default now(),
  anulado_at        timestamptz,
  anulado_motivo    text,
  -- Un "OK" sólo respalda conformidad con contacto autorizado y versión identificada.
  check (tipo <> 'conformidad' or (contacto_id is not null and version_planilla is not null))
);
create index if not exists ix_fact_conformidades_pref on public.fact_conformidades (prefactura_id);

-- ── Permisos: sólo lectura directa; escritura por RPC ─────────────────────
do $do$
declare t text;
begin
  foreach t in array array['fact_historial', 'fact_clientes', 'fact_cliente_alias', 'fact_contactos', 'fact_contratos',
    'fact_contrato_objetivos', 'fact_tarifas', 'fact_documentos', 'fact_documento_vinculos', 'fact_ordenes_compra',
    'fact_oc_objetivos', 'fact_horas_aprobaciones', 'fact_prefacturas', 'fact_oc_consumos', 'fact_ajustes', 'fact_envios', 'fact_conformidades']
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
revoke all on sequence public.fact_historial_id_seq from public, anon, authenticated;

-- ── Storage ────────────────────────────────────────────────────────────────
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('facturacion-documentos', 'facturacion-documentos', false, 20971520,
            array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv', 'text/plain', 'application/zip',
                  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'message/rfc822'])
    on conflict (id) do nothing;
    execute 'drop policy if exists fact_docs_lectura on storage.objects';
    execute $p$create policy fact_docs_lectura on storage.objects for select to authenticated
      using (bucket_id = 'facturacion-documentos' and public.facturacion_puede_actual())$p$;
    execute 'drop policy if exists fact_docs_alta on storage.objects';
    execute $p$create policy fact_docs_alta on storage.objects for insert to authenticated
      with check (bucket_id = 'facturacion-documentos' and public.facturacion_puede_actual())$p$;
  end if;
end
$do$;

-- ═══ RPC ═══════════════════════════════════════════════════════════════════

-- Cliente: alta o edición con versión optimista.
create or replace function public.fact_cliente_guardar(p_id uuid, p_datos jsonb, p_version integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_cuit text := nullif(regexp_replace(coalesce(p_datos->>'cuit', ''), '\D', '', 'g'), '');
begin
  if v_cuit is not null and not public.fact_cuit_valido(v_cuit) then raise exception 'CUIT inválido: %', p_datos->>'cuit'; end if;
  if p_id is null then
    insert into public.fact_clientes (cuit, razon_social, condicion_iva, tipo_comprobante, domicilio, notas, creado_por, actualizado_por)
    values (v_cuit, trim(p_datos->>'razon_social'), nullif(p_datos->>'condicion_iva', ''),
            nullif(p_datos->>'tipo_comprobante', '')::int, nullif(trim(p_datos->>'domicilio'), ''), p_datos->>'notas', v_actor, v_actor)
    returning id into v_id;
    perform public.fact_registrar('cliente', v_id, 'alta', p_datos, v_actor);
  else
    update public.fact_clientes set
      cuit = v_cuit, razon_social = trim(p_datos->>'razon_social'),
      condicion_iva = coalesce(nullif(p_datos->>'condicion_iva', ''), condicion_iva),
      tipo_comprobante = nullif(p_datos->>'tipo_comprobante', '')::int,
      domicilio = case when p_datos ? 'domicilio' then nullif(trim(p_datos->>'domicilio'), '') else domicilio end,
      notas = p_datos->>'notas', activo = coalesce((p_datos->>'activo')::boolean, activo),
      version = version + 1, actualizado_por = v_actor, updated_at = now()
    where id = p_id and version = coalesce(p_version, version)
    returning id into v_id;
    if v_id is null then raise exception 'El cliente cambió mientras lo editabas; recargá' using errcode = '40001'; end if;
    perform public.fact_registrar('cliente', v_id, 'edicion', p_datos, v_actor);
  end if;
  return v_id;
end $fn$;

create or replace function public.fact_alias_guardar(p_cliente_id uuid, p_alias text, p_origen text, p_confirmado boolean default false, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_otro uuid;
begin
  select cliente_id into v_otro from public.fact_cliente_alias where lower(trim(alias)) = lower(trim(p_alias)) and anulado_at is null;
  if v_otro is not null and v_otro <> p_cliente_id then
    raise exception 'El alias "%" ya está asociado a otro cliente; anulalo primero', p_alias;
  end if;
  insert into public.fact_cliente_alias (cliente_id, alias, origen, confirmado, nota, creado_por)
  values (p_cliente_id, trim(p_alias), p_origen, coalesce(p_confirmado, false), p_nota, v_actor)
  on conflict (lower(trim(alias))) where anulado_at is null
  do update set confirmado = excluded.confirmado, nota = coalesce(excluded.nota, fact_cliente_alias.nota)
  returning id into v_id;
  perform public.fact_registrar('cliente', p_cliente_id, 'alias', jsonb_build_object('alias', p_alias, 'origen', p_origen, 'confirmado', p_confirmado), v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_alias_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_cli uuid;
begin
  update public.fact_cliente_alias set anulado_at = now(), anulado_por = v_actor where id = p_id and anulado_at is null returning cliente_id into v_cli;
  if v_cli is null then raise exception 'Alias inexistente o ya anulado'; end if;
  perform public.fact_registrar('cliente', v_cli, 'alias_anulado', jsonb_build_object('alias_id', p_id, 'motivo', p_motivo), v_actor);
end $fn$;

create or replace function public.fact_contacto_guardar(p_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid;
begin
  if p_id is null then
    insert into public.fact_contactos (cliente_id, objetivo_id, nombre, email, telefono, rol, notas, creado_por)
    values ((p_datos->>'cliente_id')::uuid, nullif(p_datos->>'objetivo_id', '')::uuid, p_datos->>'nombre', p_datos->>'email',
            p_datos->>'telefono', p_datos->>'rol', p_datos->>'notas', v_actor)
    returning id into v_id;
  else
    update public.fact_contactos set objetivo_id = nullif(p_datos->>'objetivo_id', '')::uuid, nombre = p_datos->>'nombre',
      email = p_datos->>'email', telefono = p_datos->>'telefono', rol = p_datos->>'rol', notas = p_datos->>'notas',
      activo = coalesce((p_datos->>'activo')::boolean, activo), updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Contacto inexistente'; end if;
  end if;
  perform public.fact_registrar('contacto', v_id, case when p_id is null then 'alta' else 'edicion' end, p_datos, v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_contrato_guardar(p_id uuid, p_datos jsonb, p_version integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid;
  v_req text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_datos->'requisitos', '[]'::jsonb)) x), '{}');
  v_pend text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_datos->'pendientes_comerciales', '[]'::jsonb)) x), '{}');
begin
  if p_id is null then
    insert into public.fact_contratos (cliente_id, nombre, modalidad, agrupacion, regla_periodo, dia_corte, separar_diurna_nocturna, superposicion,
      franja_nocturna_desde, franja_nocturna_hasta, dias_vencimiento, requisitos, canal_entrega, envio_conjunto_planilla, requiere_portal,
      tipo_comprobante, pendientes_comerciales, vigencia_desde, vigencia_hasta, estado, notas, creado_por, actualizado_por)
    values ((p_datos->>'cliente_id')::uuid, p_datos->>'nombre', p_datos->>'modalidad', coalesce(p_datos->>'agrupacion', 'cliente'),
      coalesce(p_datos->>'regla_periodo', 'mes_calendario'), nullif(p_datos->>'dia_corte', '')::int,
      coalesce((p_datos->>'separar_diurna_nocturna')::boolean, false), coalesce(p_datos->>'superposicion', 'unir'),
      nullif(p_datos->>'franja_nocturna_desde', '')::time, nullif(p_datos->>'franja_nocturna_hasta', '')::time,
      nullif(p_datos->>'dias_vencimiento', '')::int, v_req, coalesce(p_datos->>'canal_entrega', 'email'),
      coalesce((p_datos->>'envio_conjunto_planilla')::boolean, false), coalesce((p_datos->>'requiere_portal')::boolean, false),
      nullif(p_datos->>'tipo_comprobante', '')::int, v_pend,
      nullif(p_datos->>'vigencia_desde', '')::date, nullif(p_datos->>'vigencia_hasta', '')::date,
      coalesce(p_datos->>'estado', 'borrador'), p_datos->>'notas', v_actor, v_actor)
    returning id into v_id;
  else
    update public.fact_contratos set nombre = p_datos->>'nombre', modalidad = p_datos->>'modalidad',
      agrupacion = coalesce(p_datos->>'agrupacion', agrupacion), regla_periodo = coalesce(p_datos->>'regla_periodo', regla_periodo),
      dia_corte = nullif(p_datos->>'dia_corte', '')::int,
      separar_diurna_nocturna = coalesce((p_datos->>'separar_diurna_nocturna')::boolean, separar_diurna_nocturna),
      superposicion = coalesce(p_datos->>'superposicion', superposicion),
      franja_nocturna_desde = nullif(p_datos->>'franja_nocturna_desde', '')::time, franja_nocturna_hasta = nullif(p_datos->>'franja_nocturna_hasta', '')::time,
      dias_vencimiento = nullif(p_datos->>'dias_vencimiento', '')::int, requisitos = v_req,
      canal_entrega = coalesce(p_datos->>'canal_entrega', canal_entrega),
      envio_conjunto_planilla = coalesce((p_datos->>'envio_conjunto_planilla')::boolean, envio_conjunto_planilla),
      requiere_portal = coalesce((p_datos->>'requiere_portal')::boolean, requiere_portal),
      tipo_comprobante = nullif(p_datos->>'tipo_comprobante', '')::int, pendientes_comerciales = v_pend,
      vigencia_desde = nullif(p_datos->>'vigencia_desde', '')::date, vigencia_hasta = nullif(p_datos->>'vigencia_hasta', '')::date,
      estado = coalesce(p_datos->>'estado', estado), notas = p_datos->>'notas',
      version = version + 1, actualizado_por = v_actor, updated_at = now()
    where id = p_id and version = coalesce(p_version, version) returning id into v_id;
    if v_id is null then raise exception 'El contrato cambió mientras lo editabas; recargá' using errcode = '40001'; end if;
  end if;
  perform public.fact_registrar('contrato', v_id, case when p_id is null then 'alta' else 'edicion' end, p_datos, v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_contrato_objetivo_vincular(p_contrato_id uuid, p_objetivo_id uuid, p_desde date default null, p_hasta date default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid;
begin
  insert into public.fact_contrato_objetivos (contrato_id, objetivo_id, desde, hasta, creado_por)
  values (p_contrato_id, p_objetivo_id, p_desde, p_hasta, v_actor)
  on conflict (contrato_id, objetivo_id) do update set desde = excluded.desde, hasta = excluded.hasta, anulado_at = null
  returning id into v_id;
  perform public.fact_registrar('contrato', p_contrato_id, 'objetivo_vinculado', jsonb_build_object('objetivo_id', p_objetivo_id, 'desde', p_desde, 'hasta', p_hasta), v_actor);
  return v_id;
end $fn$;

-- Tarifa nueva: cierra la anterior abierta del mismo concepto/objetivo el día previo.
create or replace function public.fact_tarifa_agregar(
  p_contrato_id uuid, p_objetivo_id uuid, p_concepto text, p_precio numeric, p_tratamiento_iva text,
  p_alicuota numeric, p_desde date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_prev record; v_anteriores jsonb := '[]'::jsonb;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo del cambio de tarifa'; end if;
  perform 1 from public.fact_contratos where id = p_contrato_id for update;
  if not found then raise exception 'Contrato inexistente'; end if;
  if exists (select 1 from public.fact_tarifas t where t.contrato_id = p_contrato_id and t.concepto = p_concepto
             and t.objetivo_id is not distinct from p_objetivo_id and t.vigencia_desde >= p_desde) then
    raise exception 'Ya hay una tarifa de % que rige desde % o después; no se pisan vigencias', p_concepto, p_desde;
  end if;
  for v_prev in select id, precio, tratamiento_iva, alicuota_iva, vigencia_desde from public.fact_tarifas t where t.contrato_id = p_contrato_id and t.concepto = p_concepto
      and t.objetivo_id is not distinct from p_objetivo_id and (t.vigencia_hasta is null or t.vigencia_hasta >= p_desde)
  loop
    update public.fact_tarifas set vigencia_hasta = p_desde - 1, cerrada_por = v_actor, cerrada_at = now() where id = v_prev.id;
    v_anteriores := v_anteriores || jsonb_build_object('tarifa_id', v_prev.id, 'precio', v_prev.precio, 'iva', v_prev.tratamiento_iva,
      'alicuota', v_prev.alicuota_iva, 'desde', v_prev.vigencia_desde, 'hasta', p_desde - 1);
  end loop;
  insert into public.fact_tarifas (contrato_id, objetivo_id, concepto, precio, tratamiento_iva, alicuota_iva, vigencia_desde, motivo, creado_por)
  values (p_contrato_id, p_objetivo_id, p_concepto, p_precio, p_tratamiento_iva, coalesce(p_alicuota, 21), p_desde, p_motivo, v_actor)
  returning id into v_id;
  perform public.fact_registrar('contrato', p_contrato_id, 'tarifa', jsonb_build_object('tarifa_id', v_id, 'concepto', p_concepto, 'precio', p_precio,
    'iva', p_tratamiento_iva, 'desde', p_desde, 'objetivo_id', p_objetivo_id, 'motivo', p_motivo, 'anteriores', v_anteriores), v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_oc_guardar(p_id uuid, p_datos jsonb, p_objetivos uuid[], p_version integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid;
begin
  if p_id is null then
    insert into public.fact_ordenes_compra (cliente_id, tipo, numero, fecha, vigencia_desde, vigencia_hasta, monto_neto_c, monto_total_c, horas, aceptado_at, condiciones, documento_id, creado_por)
    values ((p_datos->>'cliente_id')::uuid, coalesce(p_datos->>'tipo', 'orden_compra'), trim(p_datos->>'numero'),
      nullif(p_datos->>'fecha', '')::date, nullif(p_datos->>'vigencia_desde', '')::date, nullif(p_datos->>'vigencia_hasta', '')::date,
      nullif(p_datos->>'monto_neto_c', '')::bigint, nullif(p_datos->>'monto_total_c', '')::bigint,
      nullif(p_datos->>'horas', '')::numeric, nullif(p_datos->>'aceptado_at', '')::date,
      p_datos->>'condiciones', nullif(p_datos->>'documento_id', '')::uuid, v_actor)
    returning id into v_id;
  else
    update public.fact_ordenes_compra set numero = trim(p_datos->>'numero'), fecha = nullif(p_datos->>'fecha', '')::date,
      vigencia_desde = nullif(p_datos->>'vigencia_desde', '')::date, vigencia_hasta = nullif(p_datos->>'vigencia_hasta', '')::date,
      monto_neto_c = nullif(p_datos->>'monto_neto_c', '')::bigint, monto_total_c = nullif(p_datos->>'monto_total_c', '')::bigint, horas = nullif(p_datos->>'horas', '')::numeric,
      aceptado_at = nullif(p_datos->>'aceptado_at', '')::date, condiciones = p_datos->>'condiciones',
      documento_id = coalesce(nullif(p_datos->>'documento_id', '')::uuid, documento_id),
      estado = coalesce(p_datos->>'estado', estado), version = version + 1, updated_at = now()
    where id = p_id and version = coalesce(p_version, version) returning id into v_id;
    if v_id is null then raise exception 'La OC cambió mientras la editabas; recargá' using errcode = '40001'; end if;
    -- Un monto menor a lo ya consumido no se acepta.
    if exists (select 1 from public.fact_ordenes_compra o
               cross join lateral (select coalesce(sum(neto_c), 0) neto, coalesce(sum(total_c), 0) total
                                   from public.fact_oc_consumos c where c.oc_id = v_id and c.anulado_at is null) k
               where o.id = v_id and (o.monto_neto_c < k.neto or o.monto_total_c < k.total)) then
      raise exception 'El monto de la OC queda por debajo de lo ya facturado contra ella';
    end if;
    delete from public.fact_oc_objetivos where oc_id = v_id;
  end if;
  insert into public.fact_oc_objetivos (oc_id, objetivo_id) select v_id, x from unnest(coalesce(p_objetivos, '{}')) x on conflict do nothing;
  perform public.fact_registrar('orden_compra', v_id, case when p_id is null then 'alta' else 'edicion' end, p_datos || jsonb_build_object('objetivos', p_objetivos), v_actor);
  return v_id;
end $fn$;

-- Documento: registra metadatos del archivo ya subido. Si el hash existe, devuelve el original.
create or replace function public.fact_documento_registrar(p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_dup uuid; v_sha text := lower(p_datos->>'sha256');
begin
  select id into v_dup from public.fact_documentos where sha256 = v_sha and estado <> 'descartado';
  if v_dup is not null then
    return jsonb_build_object('id', v_dup, 'duplicado', true);
  end if;
  insert into public.fact_documentos (tipo, storage_path, nombre_original, mime, bytes, sha256, origen, origen_ref, remitente, asunto,
    recibido_at, cliente_id, datos_propuestos, cargado_por)
  values (p_datos->>'tipo', p_datos->>'storage_path', p_datos->>'nombre_original', p_datos->>'mime', nullif(p_datos->>'bytes', '')::bigint,
    v_sha, coalesce(p_datos->>'origen', 'carga_manual'), p_datos->>'origen_ref', p_datos->>'remitente', p_datos->>'asunto',
    coalesce(nullif(p_datos->>'recibido_at', '')::timestamptz, now()), nullif(p_datos->>'cliente_id', '')::uuid,
    p_datos->'datos_propuestos', v_actor)
  returning id into v_id;
  perform public.fact_registrar('documento', v_id, 'alta', p_datos - 'datos_propuestos', v_actor);
  return jsonb_build_object('id', v_id, 'duplicado', false);
end $fn$;

create or replace function public.fact_documento_revisar(p_id uuid, p_estado text, p_datos_confirmados jsonb, p_cliente_id uuid default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if p_estado not in ('confirmado', 'descartado', 'pendiente_revision') then raise exception 'Estado inválido'; end if;
  update public.fact_documentos set estado = p_estado, datos_confirmados = p_datos_confirmados,
    cliente_id = coalesce(p_cliente_id, cliente_id), revisado_por = v_actor, revisado_at = now()
  where id = p_id;
  if not found then raise exception 'Documento inexistente'; end if;
  perform public.fact_registrar('documento', p_id, 'revision', jsonb_build_object('estado', p_estado, 'datos', p_datos_confirmados), v_actor);
end $fn$;

create or replace function public.fact_documento_vincular(p_documento_id uuid, p_entidad text, p_entidad_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid;
begin
  insert into public.fact_documento_vinculos (documento_id, entidad, entidad_id, creado_por)
  values (p_documento_id, p_entidad, p_entidad_id, v_actor)
  on conflict (documento_id, entidad, entidad_id) where anulado_at is null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.fact_documento_vinculos where documento_id = p_documento_id and entidad = p_entidad and entidad_id = p_entidad_id and anulado_at is null;
  else
    perform public.fact_registrar('documento', p_documento_id, 'vinculo', jsonb_build_object('entidad', p_entidad, 'entidad_id', p_entidad_id), v_actor);
  end if;
  return v_id;
end $fn$;

create or replace function public.fact_documento_desvincular(p_vinculo_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_doc uuid;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la corrección'; end if;
  update public.fact_documento_vinculos set anulado_at = now(), anulado_por = v_actor, anulado_motivo = p_motivo
  where id = p_vinculo_id and anulado_at is null returning documento_id into v_doc;
  if v_doc is null then raise exception 'Vínculo inexistente o ya anulado'; end if;
  perform public.fact_registrar('documento', v_doc, 'vinculo_anulado', jsonb_build_object('vinculo_id', p_vinculo_id, 'motivo', p_motivo), v_actor);
end $fn$;

-- Horas aprobadas: foto por objetivo y período. Reemplazar anula la anterior
-- sólo si ninguna prefactura emitida la usa; las no emitidas vuelven a preparación.
create or replace function public.fact_horas_aprobar(
  p_objetivo_id uuid, p_contrato_id uuid, p_desde date, p_hasta_excl date,
  p_minutos jsonb, p_detalle jsonb, p_notas text default null, p_reemplazar boolean default false)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_prev uuid; v_id uuid;
begin
  select id into v_prev from public.fact_horas_aprobaciones
   where objetivo_id = p_objetivo_id and periodo_desde = p_desde and periodo_hasta_excl = p_hasta_excl and estado = 'aprobada' for update;
  if v_prev is not null then
    if not p_reemplazar then raise exception 'Ya hay horas aprobadas para ese objetivo y período' using errcode = '23505'; end if;
    if exists (select 1 from public.fact_prefacturas p where v_prev = any(p.horas_aprobacion_ids) and p.estado = 'emitida') then
      raise exception 'Esas horas ya se facturaron: la corrección va por nota de crédito/débito, no reemplazando la aprobación';
    end if;
    update public.fact_horas_aprobaciones set estado = 'anulada', anulado_por = v_actor, anulado_at = now(), anulado_motivo = 'reemplazada' where id = v_prev;
    -- Las prefacturas que usaban la foto anterior vuelven a preparación, con rastro.
    insert into public.fact_historial (entidad, entidad_id, accion, datos, por)
    select 'prefactura', p.id, 'horas_reemplazadas', jsonb_build_object('aprobacion_anterior', v_prev, 'estado_anterior', p.estado), v_actor
      from public.fact_prefacturas p where v_prev = any(p.horas_aprobacion_ids) and p.estado not in ('emitida', 'descartada');
    update public.fact_prefacturas set estado = 'en_preparacion', huella_aprobada = null, aprobada_por = null, aprobada_at = null, actualizado_por = v_actor
     where v_prev = any(horas_aprobacion_ids) and estado not in ('emitida', 'descartada');
  end if;
  insert into public.fact_horas_aprobaciones (objetivo_id, contrato_id, periodo_desde, periodo_hasta_excl, minutos_programados, minutos_cubiertos,
    minutos_superpuestos, minutos_descubiertos, minutos_aprobados, minutos_diurnos, minutos_nocturnos, regla_superposicion,
    tratamiento_descubiertos, detalle, notas, aprobado_por)
  values (p_objetivo_id, p_contrato_id, p_desde, p_hasta_excl, (p_minutos->>'programados')::int, (p_minutos->>'cubiertos')::int,
    coalesce((p_minutos->>'superpuestos')::int, 0), coalesce((p_minutos->>'descubiertos')::int, 0), (p_minutos->>'aprobados')::int,
    nullif(p_minutos->>'diurnos', '')::int, nullif(p_minutos->>'nocturnos', '')::int, coalesce(p_minutos->>'superposicion', 'unir'),
    coalesce(p_minutos->>'tratamiento', 'no_facturar'), coalesce(p_detalle, '[]'::jsonb), p_notas, v_actor)
  returning id into v_id;
  perform public.fact_registrar('horas', v_id, 'aprobacion', p_minutos || jsonb_build_object('objetivo_id', p_objetivo_id, 'desde', p_desde, 'hasta_excl', p_hasta_excl, 'reemplaza', v_prev), v_actor);
  return v_id;
end $fn$;

-- Prefactura: crea o actualiza con el cálculo hecho en el servidor (lib/facturacion).
-- El estado sólo avanza hasta 'lista_revision'; aprobar y emitir son RPC aparte.
create or replace function public.fact_prefactura_guardar(p_id uuid, p_datos jsonb, p_version integer default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_estado text := coalesce(p_datos->>'estado', 'en_preparacion');
begin
  if v_estado not in ('en_preparacion', 'esperando_requisitos', 'lista_revision') then
    raise exception 'Estado no permitido al guardar: %', v_estado;
  end if;
  if p_id is null then
    insert into public.fact_prefacturas (cliente_id, contrato_id, agrupacion_clave, objetivo_id, periodo_mes, periodo_desde, periodo_hasta_excl,
      estado, estado_entrega, estado_portal, responsable_id, proxima_accion, proxima_accion_fecha, horas_aprobacion_ids,
      minutos_programados, minutos_cubiertos, minutos_aprobados, minutos_descubiertos, lineas, neto_c, iva_c, total_c, requisitos, avisos,
      texto_factura, cuit_receptor, tipo_comprobante, punto_venta, fecha_vencimiento, oc_id, anticipo_prefactura_id, creado_por, actualizado_por)
    values ((p_datos->>'cliente_id')::uuid, nullif(p_datos->>'contrato_id', '')::uuid, p_datos->>'agrupacion_clave',
      nullif(p_datos->>'objetivo_id', '')::uuid, p_datos->>'periodo_mes', (p_datos->>'periodo_desde')::date, (p_datos->>'periodo_hasta_excl')::date,
      v_estado, coalesce(p_datos->>'estado_entrega', 'pendiente'), coalesce(p_datos->>'estado_portal', 'no_requiere'),
      coalesce(nullif(p_datos->>'responsable_id', '')::uuid, v_actor), p_datos->>'proxima_accion', nullif(p_datos->>'proxima_accion_fecha', '')::date,
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_datos->'horas_aprobacion_ids') x), '{}'),
      nullif(p_datos->>'minutos_programados', '')::int, nullif(p_datos->>'minutos_cubiertos', '')::int, nullif(p_datos->>'minutos_aprobados', '')::int, nullif(p_datos->>'minutos_descubiertos', '')::int,
      coalesce(p_datos->'lineas', '[]'::jsonb), nullif(p_datos->>'neto_c', '')::bigint, nullif(p_datos->>'iva_c', '')::bigint, nullif(p_datos->>'total_c', '')::bigint,
      coalesce(p_datos->'requisitos', '[]'::jsonb), coalesce(p_datos->'avisos', '[]'::jsonb),
      p_datos->>'texto_factura', p_datos->>'cuit_receptor', nullif(p_datos->>'tipo_comprobante', '')::int, nullif(p_datos->>'punto_venta', '')::int,
      nullif(p_datos->>'fecha_vencimiento', '')::date, nullif(p_datos->>'oc_id', '')::uuid, nullif(p_datos->>'anticipo_prefactura_id', '')::uuid, v_actor, v_actor)
    returning id into v_id;
    perform public.fact_registrar('prefactura', v_id, 'alta', p_datos - 'lineas', v_actor);
  else
    update public.fact_prefacturas set
      estado = case when estado = 'aprobada_emitir' then estado else v_estado end,
      responsable_id = coalesce(nullif(p_datos->>'responsable_id', '')::uuid, responsable_id),
      proxima_accion = p_datos->>'proxima_accion', proxima_accion_fecha = nullif(p_datos->>'proxima_accion_fecha', '')::date,
      horas_aprobacion_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_datos->'horas_aprobacion_ids') x), horas_aprobacion_ids),
      minutos_programados = nullif(p_datos->>'minutos_programados', '')::int, minutos_cubiertos = nullif(p_datos->>'minutos_cubiertos', '')::int, minutos_aprobados = nullif(p_datos->>'minutos_aprobados', '')::int,
      minutos_descubiertos = nullif(p_datos->>'minutos_descubiertos', '')::int,
      lineas = coalesce(p_datos->'lineas', lineas), neto_c = nullif(p_datos->>'neto_c', '')::bigint, iva_c = nullif(p_datos->>'iva_c', '')::bigint,
      total_c = nullif(p_datos->>'total_c', '')::bigint, requisitos = coalesce(p_datos->'requisitos', requisitos), avisos = coalesce(p_datos->'avisos', avisos),
      texto_factura = coalesce(p_datos->>'texto_factura', texto_factura), cuit_receptor = p_datos->>'cuit_receptor',
      tipo_comprobante = nullif(p_datos->>'tipo_comprobante', '')::int, punto_venta = nullif(p_datos->>'punto_venta', '')::int,
      fecha_vencimiento = nullif(p_datos->>'fecha_vencimiento', '')::date, oc_id = nullif(p_datos->>'oc_id', '')::uuid,
      anticipo_prefactura_id = nullif(p_datos->>'anticipo_prefactura_id', '')::uuid,
      version = version + 1, actualizado_por = v_actor
    where id = p_id and version = coalesce(p_version, version) and estado not in ('emitida', 'descartada')
    returning id into v_id;
    if v_id is null then raise exception 'La prefactura cambió, está emitida o descartada; recargá' using errcode = '40001'; end if;
    perform public.fact_registrar('prefactura', v_id, 'recalculo', p_datos - 'lineas', v_actor);
  end if;
  return v_id;
end $fn$;

create or replace function public.fact_prefactura_texto(p_id uuid, p_texto text, p_version integer)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  update public.fact_prefacturas set texto_factura = p_texto, version = version + 1, actualizado_por = v_actor
  where id = p_id and version = p_version and estado not in ('emitida', 'descartada');
  if not found then raise exception 'La prefactura cambió o ya no admite cambios; recargá' using errcode = '40001'; end if;
  perform public.fact_registrar('prefactura', p_id, 'texto', jsonb_build_object('texto', p_texto), v_actor);
end $fn$;

create or replace function public.fact_prefactura_estado(p_id uuid, p_estado text, p_version integer, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_de text;
begin
  select estado into v_de from public.fact_prefacturas where id = p_id and version = p_version for update;
  if v_de is null then raise exception 'La prefactura cambió; recargá' using errcode = '40001'; end if;
  if p_estado in ('aprobada_emitir', 'emitida') then raise exception 'Usá Aprobar / Emitir'; end if;
  if not ((v_de = 'en_preparacion' and p_estado in ('esperando_requisitos', 'lista_revision', 'descartada'))
       or (v_de = 'esperando_requisitos' and p_estado in ('en_preparacion', 'lista_revision', 'descartada'))
       or (v_de = 'lista_revision' and p_estado in ('en_preparacion', 'esperando_requisitos', 'descartada'))
       or (v_de = 'aprobada_emitir' and p_estado = 'lista_revision')
       or (v_de = 'descartada' and p_estado = 'en_preparacion')) then
    raise exception 'Transición no permitida: % → %', v_de, p_estado;
  end if;
  if p_estado = 'descartada' and coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo del descarte'; end if;
  update public.fact_prefacturas set estado = p_estado, version = version + 1, actualizado_por = v_actor,
    huella_aprobada = case when p_estado = 'lista_revision' then null else huella_aprobada end,
    aprobada_por = case when p_estado = 'lista_revision' then null else aprobada_por end,
    aprobada_at = case when p_estado = 'lista_revision' then null else aprobada_at end
  where id = p_id;
  perform public.fact_registrar('prefactura', p_id, 'estado', jsonb_build_object('de', v_de, 'a', p_estado, 'motivo', p_motivo), v_actor);
end $fn$;

create or replace function public.fact_prefactura_aprobar(p_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_prefacturas;
begin
  select * into v from public.fact_prefacturas where id = p_id and version = p_version for update;
  if v.id is null then raise exception 'La prefactura cambió; recargá' using errcode = '40001'; end if;
  if v.estado <> 'lista_revision' then raise exception 'Sólo se aprueba una prefactura lista para revisión (está %)', v.estado; end if;
  if jsonb_array_length(v.requisitos) > 0 then raise exception 'Hay requisitos pendientes'; end if;
  if v.total_c is null or v.total_c <= 0 then raise exception 'La prefactura no tiene importe calculado'; end if;
  -- Aprobar es comercial: el punto de venta y las credenciales de ARCA se exigen al emitir.
  if v.cuit_receptor is null or v.tipo_comprobante is null then
    raise exception 'Faltan CUIT del receptor o tipo de comprobante';
  end if;
  if exists (select 1 from public.fact_ajustes a where a.prefactura_id = p_id and a.anulado_at is null and a.aprobado_at is null) then
    raise exception 'Hay ajustes comerciales sin aprobar o anular';
  end if;
  update public.fact_prefacturas set estado = 'aprobada_emitir', huella_aprobada = huella, aprobada_por = v_actor, aprobada_at = now(),
    version = version + 1, actualizado_por = v_actor
  where id = p_id;
  perform public.fact_registrar('prefactura', p_id, 'aprobada', jsonb_build_object('huella', v.huella, 'total_c', v.total_c), v_actor);
end $fn$;

create or replace function public.fact_ajuste_agregar(p_prefactura_id uuid, p_descripcion text, p_importe_neto_c bigint, p_motivo text)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid;
begin
  if exists (select 1 from public.fact_prefacturas where id = p_prefactura_id and estado in ('emitida', 'descartada')) then
    raise exception 'La prefactura ya no admite ajustes';
  end if;
  insert into public.fact_ajustes (prefactura_id, descripcion, importe_neto_c, motivo, creado_por)
  values (p_prefactura_id, p_descripcion, p_importe_neto_c, p_motivo, v_actor) returning id into v_id;
  perform public.fact_registrar('prefactura', p_prefactura_id, 'ajuste', jsonb_build_object('ajuste_id', v_id, 'importe_neto_c', p_importe_neto_c, 'motivo', p_motivo), v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_ajuste_resolver(p_id uuid, p_aprobar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_pref uuid;
begin
  if p_aprobar then
    update public.fact_ajustes set aprobado_por = v_actor, aprobado_at = now() where id = p_id and aprobado_at is null and anulado_at is null returning prefactura_id into v_pref;
  else
    update public.fact_ajustes set anulado_por = v_actor, anulado_at = now(), anulado_motivo = p_motivo where id = p_id and anulado_at is null returning prefactura_id into v_pref;
  end if;
  if v_pref is null then raise exception 'Ajuste inexistente o ya resuelto'; end if;
  if exists (select 1 from public.fact_prefacturas where id = v_pref and estado = 'emitida') then
    raise exception 'La prefactura ya fue emitida: el ajuste va por nota de crédito/débito';
  end if;
  perform public.fact_registrar('prefactura', v_pref, case when p_aprobar then 'ajuste_aprobado' else 'ajuste_anulado' end, jsonb_build_object('ajuste_id', p_id, 'motivo', p_motivo), v_actor);
end $fn$;

-- Registro de un envío hecho por una persona (Sergio, Facu, etc.). No envía nada.
create or replace function public.fact_envio_registrar(p_prefactura_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_tipo text := p_datos->>'tipo';
begin
  insert into public.fact_envios (prefactura_id, tipo, version_planilla, enviado_por, destinatarios, canal, enviado_at, documento_id, notas, registrado_por)
  values (p_prefactura_id, v_tipo, p_datos->>'version_planilla', coalesce(nullif(p_datos->>'enviado_por', '')::uuid, v_actor),
    (select array_agg(x) from jsonb_array_elements_text(p_datos->'destinatarios') x), coalesce(p_datos->>'canal', 'email'),
    coalesce(nullif(p_datos->>'enviado_at', '')::timestamptz, now()), nullif(p_datos->>'documento_id', '')::uuid, p_datos->>'notas', v_actor)
  returning id into v_id;
  if v_tipo in ('factura', 'factura_y_planilla') then
    update public.fact_prefacturas set estado_entrega = 'enviada' where id = p_prefactura_id and estado = 'emitida';
  end if;
  perform public.fact_registrar('prefactura', p_prefactura_id, 'envio', p_datos || jsonb_build_object('envio_id', v_id), v_actor);
  return v_id;
end $fn$;

-- Conformidad / correcciones. Exige contacto AUTORIZADO del cliente y versión de planilla.
create or replace function public.fact_conformidad_registrar(p_prefactura_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_cli uuid; v_contacto uuid := nullif(p_datos->>'contacto_id', '')::uuid;
begin
  select cliente_id into v_cli from public.fact_prefacturas where id = p_prefactura_id;
  if v_cli is null then raise exception 'Prefactura inexistente'; end if;
  if p_datos->>'tipo' = 'conformidad' then
    if v_contacto is null or not exists (select 1 from public.fact_contactos c where c.id = v_contacto and c.cliente_id = v_cli
                                         and c.rol = 'autorizado_conformidad' and c.activo) then
      raise exception 'La conformidad necesita un contacto autorizado del cliente';
    end if;
    if coalesce(trim(p_datos->>'version_planilla'), '') = '' then raise exception 'Indicá qué versión de la planilla se conformó'; end if;
  end if;
  insert into public.fact_conformidades (prefactura_id, tipo, contacto_id, version_planilla, documento_id, texto, recibido_at, registrado_por)
  values (p_prefactura_id, p_datos->>'tipo', v_contacto, nullif(trim(p_datos->>'version_planilla'), ''), nullif(p_datos->>'documento_id', '')::uuid,
    p_datos->>'texto', coalesce(nullif(p_datos->>'recibido_at', '')::timestamptz, now()), v_actor)
  returning id into v_id;
  perform public.fact_registrar('prefactura', p_prefactura_id, p_datos->>'tipo', p_datos || jsonb_build_object('conformidad_id', v_id), v_actor);
  return v_id;
end $fn$;

do $do$
declare f text;
begin
  foreach f in array array[
    'fact_cliente_guardar(uuid, jsonb, integer)', 'fact_alias_guardar(uuid, text, text, boolean, text)', 'fact_alias_anular(uuid, text)',
    'fact_contacto_guardar(uuid, jsonb)', 'fact_contrato_guardar(uuid, jsonb, integer)', 'fact_contrato_objetivo_vincular(uuid, uuid, date, date)',
    'fact_tarifa_agregar(uuid, uuid, text, numeric, text, numeric, date, text)', 'fact_oc_guardar(uuid, jsonb, uuid[], integer)',
    'fact_documento_registrar(jsonb)', 'fact_documento_revisar(uuid, text, jsonb, uuid)', 'fact_documento_vincular(uuid, text, uuid)',
    'fact_documento_desvincular(uuid, text)', 'fact_horas_aprobar(uuid, uuid, date, date, jsonb, jsonb, text, boolean)',
    'fact_prefactura_guardar(uuid, jsonb, integer)', 'fact_prefactura_texto(uuid, text, integer)', 'fact_prefactura_estado(uuid, text, integer, text)',
    'fact_prefactura_aprobar(uuid, integer)', 'fact_ajuste_agregar(uuid, text, bigint, text)', 'fact_ajuste_resolver(uuid, boolean, text)',
    'fact_envio_registrar(uuid, jsonb)', 'fact_conformidad_registrar(uuid, jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$do$;
revoke all on function public.fact_prefactura_huella(public.fact_prefacturas) from public, anon;
revoke all on function public.fact_prefactura_antes_guardar() from public, anon, authenticated;
revoke all on function public.fact_historial_inmutable() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
