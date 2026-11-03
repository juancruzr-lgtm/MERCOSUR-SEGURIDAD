-- ═══════════════════════════════════════════════════════════════════════════
-- 20261201130000 — Facturación (2/3): comprobantes fiscales, emisión ARCA,
-- importación de "Mis Comprobantes" y presentación en portal.
--
-- SIN APLICAR — requiere autorización expresa. Depende de 20261201120000.
-- Rollback: supabase/rollback/20261201130000_facturacion_comprobantes_arca_rollback.sql
--
--  · Comprobante = (ambiente, CUIT emisor, tipo, punto de venta, número).
--    Homologación y producción NO se mezclan: el tablero sólo lee producción.
--  · Un comprobante autorizado es inmutable en sus datos fiscales; las
--    correcciones son NC/ND vinculadas (alcance total o parcial).
--  · Emisión idempotente: una solicitud viva por prefactura y huella aprobada.
--    Respuesta incierta → estado 'incierta': antes de reintentar hay que
--    CONSULTAR a ARCA (FECompConsultar). Un borrador nunca es "emitido".
--  · La emisión en PRODUCCIÓN queda APAGADA (fact_config.emision.produccion_habilitada
--    = false). Se habilita sólo por SQL explícito cuando haya certificado y
--    punto de venta Web Service autorizados.
--  · Importación del CSV de ARCA: queda EN REVISIÓN; los duplicados (mismo
--    archivo o mismo comprobante repetido) no se multiplican.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.fact_config (
  clave           text primary key,
  valor           jsonb not null,
  actualizado_at  timestamptz not null default now()
);
insert into public.fact_config (clave, valor) values
  ('emision', jsonb_build_object('cuit_emisor', '30710705417', 'produccion_habilitada', false, 'homologacion_habilitada', true))
on conflict (clave) do nothing;

create table if not exists public.fact_importaciones (
  id               uuid primary key default gen_random_uuid(),
  tipo             text not null check (tipo in ('arca_emitidos', 'extracto_banco', 'excel_historico')),
  nombre_archivo   text not null,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  documento_id     uuid references public.fact_documentos(id),
  estado           text not null default 'en_revision' check (estado in ('en_revision', 'confirmada', 'descartada')),
  resumen          jsonb not null default '{}'::jsonb,
  creado_por       uuid references public.usuarios(id) on delete set null,
  created_at       timestamptz not null default now(),
  cerrada_por      uuid references public.usuarios(id) on delete set null,
  cerrada_at       timestamptz
);
create unique index if not exists ux_fact_importacion_archivo on public.fact_importaciones (tipo, sha256) where estado <> 'descartada';

create table if not exists public.fact_comprobantes (
  id                 uuid primary key default gen_random_uuid(),
  ambiente           text not null default 'produccion' check (ambiente in ('produccion', 'homologacion')),
  cuit_emisor        text not null check (cuit_emisor ~ '^\d{11}$'),
  tipo               integer not null check (tipo in (1, 2, 3, 6, 7, 8, 201, 202, 203)),
  punto_venta        integer not null check (punto_venta between 1 and 99998),
  numero             bigint not null check (numero between 1 and 99999999),
  fecha_emision      date not null,
  cliente_id         uuid references public.fact_clientes(id),
  doc_tipo_receptor  integer,
  doc_nro_receptor   text,
  receptor_nombre    text,
  concepto           integer check (concepto in (1, 2, 3)),
  servicio_desde     date,
  servicio_hasta     date,
  vto_pago           date,
  neto_c             bigint not null default 0,
  no_gravado_c       bigint not null default 0,
  exento_c           bigint not null default 0,
  iva_c              bigint not null default 0,
  tributos_c         bigint not null default 0,
  total_c            bigint not null check (total_c >= 0),
  moneda             text not null default 'PES',
  cotizacion         numeric(14, 6) not null default 1,
  cae                text,
  cae_vto            date,
  origen             text not null check (origen in ('emision_app', 'importacion_arca', 'carga_manual')),
  importacion_id     uuid references public.fact_importaciones(id),
  prefactura_id      uuid references public.fact_prefacturas(id),
  asociado_id        uuid references public.fact_comprobantes(id),
  alcance_nota       text check (alcance_nota in ('total', 'parcial')),
  motivo             text,
  respuesta_arca     jsonb,
  notas              text,
  creado_por         uuid references public.usuarios(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (ambiente, cuit_emisor, tipo, punto_venta, numero),
  check (total_c = neto_c + no_gravado_c + exento_c + iva_c + tributos_c or origen = 'importacion_arca'),
  check (origen <> 'emision_app' or (cae is not null and cae_vto is not null)),
  check (origen <> 'emision_app' or tipo in (1, 6, 201) or asociado_id is not null)
);
create index if not exists ix_fact_comprobantes_cliente on public.fact_comprobantes (cliente_id, fecha_emision) where ambiente = 'produccion';
create index if not exists ix_fact_comprobantes_asociado on public.fact_comprobantes (asociado_id) where asociado_id is not null;
create unique index if not exists ux_fact_comprobante_prefactura on public.fact_comprobantes (prefactura_id)
  where prefactura_id is not null and ambiente = 'produccion' and tipo in (1, 6, 201);

-- Datos fiscales inmutables. Sólo se completan asociaciones vacías (cliente,
-- comprobante asociado, prefactura) y notas.
create or replace function public.fact_comprobante_inmutable()
returns trigger language plpgsql as $fn$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then raise exception 'Un comprobante fiscal no se borra' using errcode = '42501'; end if;
  if (new.ambiente, new.cuit_emisor, new.tipo, new.punto_venta, new.numero, new.fecha_emision, new.neto_c, new.no_gravado_c,
      new.exento_c, new.iva_c, new.tributos_c, new.total_c, new.cae, new.cae_vto, new.doc_nro_receptor, new.servicio_desde,
      new.servicio_hasta, new.vto_pago, new.origen)
     is distinct from
     (old.ambiente, old.cuit_emisor, old.tipo, old.punto_venta, old.numero, old.fecha_emision, old.neto_c, old.no_gravado_c,
      old.exento_c, old.iva_c, old.tributos_c, old.total_c, old.cae, old.cae_vto, old.doc_nro_receptor, old.servicio_desde,
      old.servicio_hasta, old.vto_pago, old.origen) then
    raise exception 'Un comprobante autorizado no se modifica: corregir con nota de crédito/débito' using errcode = '42501';
  end if;
  if old.cliente_id is not null and new.cliente_id is distinct from old.cliente_id
     or old.asociado_id is not null and new.asociado_id is distinct from old.asociado_id
     or old.prefactura_id is not null and new.prefactura_id is distinct from old.prefactura_id then
    raise exception 'La asociación del comprobante ya estaba fijada' using errcode = '42501';
  end if;
  return new;
end $fn$;
drop trigger if exists fact_comprobante_inmutable_trunc on public.fact_comprobantes;
drop trigger if exists fact_comprobante_inmutable on public.fact_comprobantes;
create trigger fact_comprobante_inmutable before update or delete on public.fact_comprobantes
  for each row execute function public.fact_comprobante_inmutable();
create trigger fact_comprobante_inmutable_trunc before truncate on public.fact_comprobantes
  for each statement execute function public.fact_comprobante_inmutable();

create table if not exists public.fact_importacion_filas (
  id               uuid primary key default gen_random_uuid(),
  importacion_id   uuid not null references public.fact_importaciones(id),
  clave            text not null,
  datos            jsonb not null,
  estado           text not null default 'nuevo' check (estado in ('nuevo', 'ya_existe', 'difiere', 'confirmado', 'descartado')),
  repeticiones     integer not null default 1,
  comprobante_id   uuid references public.fact_comprobantes(id),
  diferencias      jsonb,
  unique (importacion_id, clave)
);

-- Solicitudes de emisión (facturas desde prefactura; NC/ND desde un comprobante).
create table if not exists public.fact_emisiones (
  id                       uuid primary key default gen_random_uuid(),
  prefactura_id            uuid references public.fact_prefacturas(id),
  comprobante_asociado_id  uuid references public.fact_comprobantes(id),
  clave_idempotencia       text not null unique,
  ambiente                 text not null check (ambiente in ('produccion', 'homologacion')),
  cuit_emisor              text not null,
  tipo                     integer not null check (tipo in (1, 2, 3, 6, 7, 8, 201, 202, 203)),
  punto_venta              integer not null,
  numero                   bigint,
  estado                   text not null default 'preparada'
                             check (estado in ('pendiente_aprobacion', 'preparada', 'enviando', 'autorizada', 'rechazada', 'incierta', 'abandonada')),
  alcance_nota             text check (alcance_nota in ('total', 'parcial')),
  motivo                   text,
  solicitud                jsonb not null,
  respuesta                jsonb,
  observaciones            text,
  intentos                 integer not null default 0,
  -- Todo número que se llegó a enviar: antes de pedir uno nuevo se consultan TODOS.
  numeros_intentados       bigint[] not null default '{}',
  ultimo_intento_at        timestamptz,
  consultada_at            timestamptz,
  comprobante_id           uuid references public.fact_comprobantes(id),
  creado_por               uuid references public.usuarios(id) on delete set null,
  aprobado_por             uuid references public.usuarios(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (prefactura_id is not null or comprobante_asociado_id is not null)
);
create unique index if not exists ux_fact_emision_viva_pref on public.fact_emisiones (prefactura_id, ambiente)
  where prefactura_id is not null and estado in ('preparada', 'enviando', 'incierta', 'autorizada');
create unique index if not exists ux_fact_emision_numero on public.fact_emisiones (ambiente, cuit_emisor, tipo, punto_venta, numero)
  where numero is not null and estado in ('enviando', 'incierta', 'autorizada');

create table if not exists public.fact_portal_presentaciones (
  id               uuid primary key default gen_random_uuid(),
  prefactura_id    uuid not null references public.fact_prefacturas(id),
  comprobante_id   uuid references public.fact_comprobantes(id),
  presentado_at    timestamptz not null,
  responsable_id   uuid not null references public.usuarios(id),
  estado           text not null check (estado in ('presentada', 'observada', 'aceptada', 'rechazada')),
  numero_tramite   text,
  documento_id     uuid references public.fact_documentos(id),
  notas            text,
  registrado_por   uuid references public.usuarios(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists ix_fact_portal_pref on public.fact_portal_presentaciones (prefactura_id, presentado_at);

do $do$
declare t text;
begin
  foreach t in array array['fact_config', 'fact_importaciones', 'fact_comprobantes', 'fact_importacion_filas', 'fact_emisiones', 'fact_portal_presentaciones']
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

-- ═══ RPC ═══════════════════════════════════════════════════════════════════

-- Saldo FISCAL de un comprobante de deuda: total + ND − NC asociadas (producción).
create or replace function public.fact_saldo_fiscal(p_comprobante_id uuid)
returns bigint language sql stable security definer set search_path = public, pg_catalog as $fn$
  select c.total_c
       + coalesce((select sum(n.total_c) from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (2, 7, 202) and n.ambiente = c.ambiente), 0)
       - coalesce((select sum(n.total_c) from public.fact_comprobantes n where n.asociado_id = c.id and n.tipo in (3, 8, 203) and n.ambiente = c.ambiente), 0)
  from public.fact_comprobantes c where c.id = p_comprobante_id
$fn$;
-- Sin gate propio: sólo la usan otras funciones (security definer). No se expone.
revoke all on function public.fact_saldo_fiscal(uuid) from public, anon, authenticated;

create or replace function public.fact_letra(p_tipo integer)
returns text language sql immutable as $fn$
  select case when p_tipo in (1, 2, 3) then 'A' when p_tipo in (6, 7, 8) then 'B' when p_tipo in (201, 202, 203) then 'FCE_A' end
$fn$;

-- Prepara la emisión de una prefactura aprobada. Idempotente.
create or replace function public.fact_emision_preparar(p_prefactura_id uuid, p_version integer, p_ambiente text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v public.fact_prefacturas; v_cfg jsonb; v_id uuid; v_ex public.fact_emisiones; v_clave text;
begin
  if p_ambiente not in ('produccion', 'homologacion') then raise exception 'Ambiente inválido'; end if;
  select valor into v_cfg from public.fact_config where clave = 'emision';
  if p_ambiente = 'produccion' and not coalesce((v_cfg->>'produccion_habilitada')::boolean, false) then
    raise exception 'La emisión real en ARCA está deshabilitada (falta certificado / punto de venta habilitado)' using errcode = '42501';
  end if;
  select * into v from public.fact_prefacturas where id = p_prefactura_id for update;
  if v.id is null then raise exception 'Prefactura inexistente'; end if;
  if v.estado <> 'aprobada_emitir' or v.huella is distinct from v.huella_aprobada then
    raise exception 'Sólo se emite una prefactura aprobada y sin cambios desde la aprobación';
  end if;
  if v.version <> p_version then raise exception 'La prefactura cambió; recargá' using errcode = '40001'; end if;
  v_clave := v.id::text || ':' || v.huella_aprobada || ':' || p_ambiente;
  select * into v_ex from public.fact_emisiones where clave_idempotencia = v_clave;
  if v_ex.id is not null then
    return jsonb_build_object('id', v_ex.id, 'estado', v_ex.estado, 'existente', true);
  end if;
  select * into v_ex from public.fact_emisiones e where e.prefactura_id = v.id and e.ambiente = p_ambiente and e.estado in ('preparada', 'enviando', 'incierta', 'autorizada');
  if v_ex.id is not null then
    return jsonb_build_object('id', v_ex.id, 'estado', v_ex.estado, 'existente', true);
  end if;
  insert into public.fact_emisiones (prefactura_id, clave_idempotencia, ambiente, cuit_emisor, tipo, punto_venta, estado, solicitud, creado_por, aprobado_por)
  values (v.id, v_clave, p_ambiente, v_cfg->>'cuit_emisor', v.tipo_comprobante, v.punto_venta, 'preparada',
    jsonb_build_object('cuit_receptor', v.cuit_receptor, 'periodo_desde', v.periodo_desde, 'periodo_hasta', v.periodo_hasta_excl - 1,
      'vto_pago', v.fecha_vencimiento, 'neto_c', v.neto_c, 'iva_c', v.iva_c, 'total_c', v.total_c, 'lineas', v.lineas,
      'texto', v.texto_factura, 'cliente_id', v.cliente_id, 'huella', v.huella_aprobada),
    v_actor, v.aprobada_por)
  returning id into v_id;
  perform public.fact_registrar('prefactura', v.id, 'emision_preparada', jsonb_build_object('emision_id', v_id, 'ambiente', p_ambiente), v_actor);
  return jsonb_build_object('id', v_id, 'estado', 'preparada', 'existente', false);
end $fn$;

-- NC / ND sobre un comprobante: queda pendiente de aprobación.
create or replace function public.fact_nota_solicitar(p_comprobante_id uuid, p_tipo integer, p_neto_c bigint, p_iva_c bigint, p_motivo text, p_ambiente text default 'produccion')
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); c public.fact_comprobantes; v_saldo bigint; v_total bigint := p_neto_c + p_iva_c; v_id uuid; v_alc text;
  v_previas bigint;
begin
  select * into c from public.fact_comprobantes where id = p_comprobante_id;
  if c.id is null then raise exception 'Comprobante inexistente'; end if;
  if c.tipo not in (1, 6, 201) then raise exception 'Las notas se asocian a una factura'; end if;
  if public.fact_letra(p_tipo) is distinct from public.fact_letra(c.tipo) or p_tipo in (1, 6, 201) then
    raise exception 'El tipo de nota no corresponde a la factura (letra o familia distinta)';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la nota'; end if;
  if v_total <= 0 then raise exception 'Importe inválido'; end if;
  if p_tipo in (3, 8, 203) then
    -- Lo que queda por acreditar descuenta NC autorizadas y NC en curso.
    select coalesce(sum((e.solicitud->>'total_c')::bigint), 0) into v_previas from public.fact_emisiones e
     where e.comprobante_asociado_id = c.id and e.tipo in (3, 8, 203) and e.estado in ('pendiente_aprobacion', 'preparada', 'enviando', 'incierta');
    v_saldo := public.fact_saldo_fiscal(c.id) - v_previas;
    if v_total > v_saldo then raise exception 'La nota de crédito supera lo que queda por acreditar (%)', v_saldo; end if;
    v_alc := case when v_total = v_saldo then 'total' else 'parcial' end;
  end if;
  insert into public.fact_emisiones (comprobante_asociado_id, clave_idempotencia, ambiente, cuit_emisor, tipo, punto_venta, estado, alcance_nota, motivo, solicitud, creado_por)
  values (c.id, 'nota:' || gen_random_uuid()::text, p_ambiente, c.cuit_emisor, p_tipo, c.punto_venta, 'pendiente_aprobacion', v_alc, p_motivo,
    jsonb_build_object('cuit_receptor', c.doc_nro_receptor, 'neto_c', p_neto_c, 'iva_c', p_iva_c, 'total_c', v_total, 'cliente_id', c.cliente_id,
      'asociado', jsonb_build_object('tipo', c.tipo, 'punto_venta', c.punto_venta, 'numero', c.numero, 'cuit', c.cuit_emisor, 'fecha', c.fecha_emision),
      'periodo_desde', c.servicio_desde, 'periodo_hasta', c.servicio_hasta, 'texto', p_motivo),
    v_actor)
  returning id into v_id;
  perform public.fact_registrar('comprobante', c.id, 'nota_solicitada', jsonb_build_object('emision_id', v_id, 'tipo', p_tipo, 'total_c', v_total, 'alcance', v_alc, 'motivo', p_motivo), v_actor);
  return v_id;
end $fn$;

create or replace function public.fact_nota_aprobar(p_emision_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_cfg jsonb; e public.fact_emisiones;
begin
  select * into e from public.fact_emisiones where id = p_emision_id for update;
  if e.id is null or e.estado <> 'pendiente_aprobacion' then raise exception 'La nota no está pendiente de aprobación'; end if;
  -- La aprobación es un paso explícito y queda registrada (quién pidió / quién aprobó);
  -- Administración puede aprobar su propia nota (regla comercial aprobada).
  select valor into v_cfg from public.fact_config where clave = 'emision';
  if e.ambiente = 'produccion' and not coalesce((v_cfg->>'produccion_habilitada')::boolean, false) then
    raise exception 'La emisión real en ARCA está deshabilitada' using errcode = '42501';
  end if;
  update public.fact_emisiones set estado = 'preparada', aprobado_por = v_actor, updated_at = now() where id = e.id;
  perform public.fact_registrar('comprobante', e.comprobante_asociado_id, 'nota_aprobada', jsonb_build_object('emision_id', e.id), v_actor);
end $fn$;

-- ── Ciclo de envío a ARCA (sólo service_role: lo llama la ruta del servidor) ──
create or replace function public.fact_emision_iniciar_envio(p_emision_id uuid, p_numero bigint, p_solicitud_arca jsonb)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare e public.fact_emisiones;
begin
  select * into e from public.fact_emisiones where id = p_emision_id for update;
  if e.id is null then raise exception 'Emisión inexistente'; end if;
  if e.estado = 'incierta' then raise exception 'Respuesta incierta previa: consultar ARCA antes de reintentar' using errcode = '55000'; end if;
  if e.estado not in ('preparada', 'rechazada') then raise exception 'La emisión está % y no admite envío', e.estado; end if;
  if e.estado = 'rechazada' and e.prefactura_id is not null and exists (
       select 1 from public.fact_emisiones o where o.prefactura_id = e.prefactura_id and o.ambiente = e.ambiente and o.id <> e.id
         and o.estado in ('preparada', 'enviando', 'incierta', 'autorizada')) then
    raise exception 'Ya hay otra emisión viva para esta prefactura';
  end if;
  -- Reusar un número confirmado como inexistente es correcto (ARCA no lo consumió);
  -- el ciclo del servidor consulta TODOS los intentados antes de volver a enviar.
  update public.fact_emisiones set estado = 'enviando', numero = p_numero, intentos = intentos + 1, ultimo_intento_at = now(),
    numeros_intentados = numeros_intentados || p_numero,
    respuesta = null, updated_at = now(), solicitud = solicitud || jsonb_build_object('arca', p_solicitud_arca)
  where id = e.id;
end $fn$;

-- Alta del comprobante autorizado (común a resultado directo y consulta).
create or replace function public.fact_emision_autorizar_interno(e public.fact_emisiones, p_cae text, p_cae_vto date, p_fecha date, p_respuesta jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_comp uuid; s jsonb := e.solicitud; v_pref public.fact_prefacturas; v_req_portal boolean;
begin
  insert into public.fact_comprobantes (ambiente, cuit_emisor, tipo, punto_venta, numero, fecha_emision, cliente_id, doc_tipo_receptor, doc_nro_receptor,
    concepto, servicio_desde, servicio_hasta, vto_pago, neto_c, iva_c, total_c, cae, cae_vto, origen, prefactura_id, asociado_id, alcance_nota, motivo,
    respuesta_arca, creado_por)
  values (e.ambiente, e.cuit_emisor, e.tipo, e.punto_venta, e.numero, p_fecha, nullif(s->>'cliente_id', '')::uuid, 80, s->>'cuit_receptor',
    2, nullif(s->>'periodo_desde', '')::date, nullif(s->>'periodo_hasta', '')::date, nullif(s->>'vto_pago', '')::date,
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
      insert into public.fact_oc_consumos (oc_id, prefactura_id, neto_c, horas)
      values (v_pref.oc_id, v_pref.id, v_pref.neto_c, coalesce(v_pref.minutos_aprobados, 0) / 60.0)
      on conflict (oc_id, prefactura_id) where anulado_at is null do nothing;
    end if;
  end if;
  insert into public.fact_historial (entidad, entidad_id, accion, datos, por)
  values ('comprobante', v_comp, 'autorizado', jsonb_build_object('emision_id', e.id, 'cae', p_cae, 'ambiente', e.ambiente), e.creado_por);
  return v_comp;
end $fn$;

-- p_resultado: 'A' aprobado, 'R' rechazado, 'incierta' (timeout / error de red / respuesta ilegible).
create or replace function public.fact_emision_resultado(p_emision_id uuid, p_resultado text, p_respuesta jsonb, p_cae text default null,
  p_cae_vto date default null, p_fecha date default null, p_observaciones text default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare e public.fact_emisiones;
begin
  select * into e from public.fact_emisiones where id = p_emision_id for update;
  if e.id is null or e.estado <> 'enviando' then raise exception 'La emisión no está en envío'; end if;
  if p_resultado = 'A' then
    if p_cae is null or p_cae_vto is null or p_fecha is null then raise exception 'Aprobación sin CAE: se trata como incierta'; end if;
    return public.fact_emision_autorizar_interno(e, p_cae, p_cae_vto, p_fecha, p_respuesta);
  elsif p_resultado = 'R' then
    update public.fact_emisiones set estado = 'rechazada', respuesta = p_respuesta, observaciones = p_observaciones, numero = null, updated_at = now() where id = e.id;
  elsif p_resultado = 'incierta' then
    update public.fact_emisiones set estado = 'incierta', respuesta = p_respuesta, observaciones = p_observaciones, updated_at = now() where id = e.id;
  else
    raise exception 'Resultado inválido: %', p_resultado;
  end if;
  return null;
end $fn$;

-- Resultado de FECompConsultar. p_numero = número consultado (uno de numeros_intentados).
--  · 'incierta' o 'enviando' colgada (> 2 min sin respuesta): se resuelve con la consulta.
--  · 'enviando' reciente: NO, puede haber una respuesta en camino; consultar ahí y
--    marcar "no existe" permitiría pedir otro número y emitir dos facturas.
--  · 'rechazada': sólo para recuperar un número intentado antes que sí quedó autorizado.
-- "No existe" nunca pasa una 'rechazada' a otro estado ni borra los números intentados.
create or replace function public.fact_emision_consulta(p_emision_id uuid, p_encontrado boolean, p_respuesta jsonb,
  p_cae text default null, p_cae_vto date default null, p_fecha date default null, p_total_c bigint default null, p_numero bigint default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare e public.fact_emisiones; v_num bigint;
begin
  select * into e from public.fact_emisiones where id = p_emision_id for update;
  if e.id is null then raise exception 'Emisión inexistente'; end if;
  v_num := coalesce(p_numero, e.numero);
  if v_num is null or not (v_num = any(e.numeros_intentados)) then raise exception 'Sólo se consulta un número que se llegó a enviar'; end if;
  if e.estado = 'enviando' and e.ultimo_intento_at > now() - interval '2 minutes' then
    raise exception 'Hay un envío en curso: esperar su respuesta antes de consultar' using errcode = '55000';
  end if;
  if e.estado not in ('incierta', 'enviando', 'rechazada') then raise exception 'La emisión está % y no se consulta', e.estado; end if;
  update public.fact_emisiones set consultada_at = now() where id = e.id;
  if p_encontrado then
    if p_total_c is distinct from (e.solicitud->>'total_c')::bigint or p_cae is null or p_cae_vto is null or p_fecha is null then
      -- Sin borrar nada: queda incierta y bloqueada hasta revisión manual.
      update public.fact_emisiones set estado = 'incierta', numero = v_num, respuesta = p_respuesta,
        observaciones = 'ARCA tiene el número ' || v_num || ' con otros datos: revisar a mano antes de seguir', updated_at = now() where id = e.id;
      return null;
    end if;
    e.numero := v_num;
    update public.fact_emisiones set numero = v_num where id = e.id;
    return public.fact_emision_autorizar_interno(e, p_cae, p_cae_vto, p_fecha, p_respuesta);
  end if;
  if e.estado <> 'rechazada' then
    update public.fact_emisiones set estado = 'rechazada', numero = null, respuesta = p_respuesta,
      observaciones = 'No existe en ARCA tras consulta: se puede reintentar', updated_at = now() where id = e.id;
  end if;
  return null;
end $fn$;

-- ── Importación del CSV "Mis Comprobantes – Emitidos" ──────────────────────
-- p_filas: [{clave, tipo, punto_venta, numero, fecha, doc_nro_receptor, receptor_nombre, neto_c, iva_c, exento_c, no_gravado_c, total_c, cae, moneda}]
create or replace function public.fact_importacion_arca_crear(p_nombre text, p_sha256 text, p_documento_id uuid, p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_cuit text; f jsonb; v_comp public.fact_comprobantes; v_n int := 0; v_rep int := 0;
begin
  select id into v_id from public.fact_importaciones where tipo = 'arca_emitidos' and sha256 = lower(p_sha256) and estado <> 'descartada';
  if v_id is not null then return jsonb_build_object('id', v_id, 'duplicado', true); end if;
  select valor->>'cuit_emisor' into v_cuit from public.fact_config where clave = 'emision';
  insert into public.fact_importaciones (tipo, nombre_archivo, sha256, documento_id, creado_por)
  values ('arca_emitidos', p_nombre, lower(p_sha256), p_documento_id, v_actor) returning id into v_id;
  for f in select * from jsonb_array_elements(p_filas) loop
    insert into public.fact_importacion_filas (importacion_id, clave, datos) values (v_id, f->>'clave', f)
    on conflict (importacion_id, clave) do update set repeticiones = fact_importacion_filas.repeticiones + 1;
    v_n := v_n + 1;
  end loop;
  -- Contra lo ya registrado: igual / difiere.
  for f in select to_jsonb(r) from public.fact_importacion_filas r where r.importacion_id = v_id loop
    select * into v_comp from public.fact_comprobantes c where c.ambiente = 'produccion' and c.cuit_emisor = v_cuit
      and c.tipo = (f->'datos'->>'tipo')::int and c.punto_venta = (f->'datos'->>'punto_venta')::int and c.numero = (f->'datos'->>'numero')::bigint;
    if v_comp.id is not null then
      update public.fact_importacion_filas set comprobante_id = v_comp.id,
        estado = case when v_comp.total_c = (f->'datos'->>'total_c')::bigint and v_comp.fecha_emision = (f->'datos'->>'fecha')::date then 'ya_existe' else 'difiere' end,
        diferencias = case when v_comp.total_c = (f->'datos'->>'total_c')::bigint then null
                      else jsonb_build_object('total_registrado', v_comp.total_c, 'total_arca', (f->'datos'->>'total_c')::bigint) end
      where id = (f->>'id')::uuid;
    end if;
  end loop;
  select coalesce(sum(repeticiones - 1), 0) into v_rep from public.fact_importacion_filas where importacion_id = v_id;
  update public.fact_importaciones set resumen = jsonb_build_object(
    'filas_leidas', v_n, 'comprobantes_unicos', (select count(*) from public.fact_importacion_filas where importacion_id = v_id),
    'repetidas', v_rep,
    'por_estado', (select jsonb_object_agg(estado, n) from (select estado, count(*) n from public.fact_importacion_filas where importacion_id = v_id group by estado) s))
  where id = v_id;
  perform public.fact_registrar('importacion', v_id, 'alta', jsonb_build_object('nombre', p_nombre, 'filas', v_n), v_actor);
  return jsonb_build_object('id', v_id, 'duplicado', false);
end $fn$;

-- Confirma filas 'nuevo' como comprobantes de producción (origen ARCA). Cliente por CUIT si existe.
create or replace function public.fact_importacion_arca_confirmar(p_importacion_id uuid, p_claves text[])
returns integer language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_cuit text; r record; v_comp uuid; v_n int := 0; d jsonb;
begin
  if not exists (select 1 from public.fact_importaciones where id = p_importacion_id and tipo = 'arca_emitidos' and estado = 'en_revision') then
    raise exception 'La importación no está en revisión';
  end if;
  select valor->>'cuit_emisor' into v_cuit from public.fact_config where clave = 'emision';
  for r in select * from public.fact_importacion_filas where importacion_id = p_importacion_id and estado = 'nuevo' and clave = any(p_claves) for update loop
    d := r.datos;
    insert into public.fact_comprobantes (ambiente, cuit_emisor, tipo, punto_venta, numero, fecha_emision, cliente_id, doc_tipo_receptor, doc_nro_receptor,
      receptor_nombre, neto_c, iva_c, exento_c, no_gravado_c, total_c, moneda, cae, origen, importacion_id, creado_por)
    values ('produccion', v_cuit, (d->>'tipo')::int, (d->>'punto_venta')::int, (d->>'numero')::bigint, (d->>'fecha')::date,
      (select c.id from public.fact_clientes c where c.cuit = regexp_replace(coalesce(d->>'doc_nro_receptor', ''), '\D', '', 'g')),
      nullif(d->>'doc_tipo_receptor', '')::int, d->>'doc_nro_receptor', d->>'receptor_nombre',
      coalesce((d->>'neto_c')::bigint, 0), coalesce((d->>'iva_c')::bigint, 0), coalesce((d->>'exento_c')::bigint, 0),
      coalesce((d->>'no_gravado_c')::bigint, 0), (d->>'total_c')::bigint, coalesce(d->>'moneda', 'PES'), d->>'cae', 'importacion_arca', p_importacion_id, v_actor)
    on conflict (ambiente, cuit_emisor, tipo, punto_venta, numero) do nothing
    returning id into v_comp;
    if v_comp is not null then
      update public.fact_importacion_filas set estado = 'confirmado', comprobante_id = v_comp where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  perform public.fact_registrar('importacion', p_importacion_id, 'confirmar', jsonb_build_object('confirmados', v_n), v_actor);
  return v_n;
end $fn$;

create or replace function public.fact_importacion_cerrar(p_importacion_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate();
begin
  if p_estado not in ('confirmada', 'descartada') then raise exception 'Estado inválido'; end if;
  if p_estado = 'descartada' and exists (select 1 from public.fact_importacion_filas where importacion_id = p_importacion_id and estado = 'confirmado') then
    raise exception 'Ya hay comprobantes confirmados desde esta importación; no se descarta';
  end if;
  update public.fact_importaciones set estado = p_estado, cerrada_por = v_actor, cerrada_at = now() where id = p_importacion_id and estado = 'en_revision';
  if not found then raise exception 'La importación no está en revisión'; end if;
  perform public.fact_registrar('importacion', p_importacion_id, p_estado, '{}'::jsonb, v_actor);
end $fn$;

-- Asociaciones que el CSV no trae (cliente, factura de una NC, prefactura).
create or replace function public.fact_comprobante_asociar(p_id uuid, p_cliente_id uuid, p_asociado_id uuid, p_prefactura_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); c public.fact_comprobantes; a public.fact_comprobantes; v_alc text; v_saldo bigint;
begin
  select * into c from public.fact_comprobantes where id = p_id for update;
  if c.id is null then raise exception 'Comprobante inexistente'; end if;
  if p_asociado_id is not null then
    select * into a from public.fact_comprobantes where id = p_asociado_id;
    if a.id is null or a.tipo not in (1, 6, 201) or c.tipo in (1, 6, 201) or public.fact_letra(a.tipo) is distinct from public.fact_letra(c.tipo)
       or a.ambiente <> c.ambiente then
      raise exception 'La nota y la factura no son compatibles (letra/familia/ambiente)';
    end if;
    if c.tipo in (3, 8, 203) then
      v_saldo := public.fact_saldo_fiscal(a.id);
      if c.total_c > v_saldo then raise exception 'La NC supera lo que queda por acreditar de la factura (%)', v_saldo; end if;
      v_alc := case when c.total_c = v_saldo then 'total' else 'parcial' end;
    end if;
  end if;
  update public.fact_comprobantes set cliente_id = coalesce(cliente_id, p_cliente_id), asociado_id = coalesce(asociado_id, p_asociado_id),
    alcance_nota = coalesce(alcance_nota, v_alc), prefactura_id = coalesce(prefactura_id, p_prefactura_id), motivo = coalesce(motivo, p_motivo)
  where id = p_id;
  perform public.fact_registrar('comprobante', p_id, 'asociacion', jsonb_build_object('cliente_id', p_cliente_id, 'asociado_id', p_asociado_id,
    'prefactura_id', p_prefactura_id, 'alcance', v_alc, 'motivo', p_motivo), v_actor);
end $fn$;

create or replace function public.fact_portal_registrar(p_prefactura_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare v_actor uuid := public.facturacion_gate(); v_id uuid; v_estado text := p_datos->>'estado';
begin
  if not exists (select 1 from public.fact_prefacturas where id = p_prefactura_id and estado = 'emitida') then
    raise exception 'La presentación en portal se registra después de emitir';
  end if;
  insert into public.fact_portal_presentaciones (prefactura_id, comprobante_id, presentado_at, responsable_id, estado, numero_tramite, documento_id, notas, registrado_por)
  values (p_prefactura_id, (select id from public.fact_comprobantes where prefactura_id = p_prefactura_id and ambiente = 'produccion' limit 1),
    coalesce(nullif(p_datos->>'presentado_at', '')::timestamptz, now()), coalesce(nullif(p_datos->>'responsable_id', '')::uuid, v_actor),
    v_estado, p_datos->>'numero_tramite', nullif(p_datos->>'documento_id', '')::uuid, p_datos->>'notas', v_actor)
  returning id into v_id;
  update public.fact_prefacturas set estado_portal = case v_estado when 'rechazada' then 'observada' else v_estado end where id = p_prefactura_id;
  perform public.fact_registrar('prefactura', p_prefactura_id, 'portal', p_datos || jsonb_build_object('presentacion_id', v_id), v_actor);
  return v_id;
end $fn$;

do $do$
declare f text;
begin
  foreach f in array array['fact_emision_preparar(uuid, integer, text)', 'fact_nota_solicitar(uuid, integer, bigint, bigint, text, text)',
    'fact_nota_aprobar(uuid)', 'fact_importacion_arca_crear(text, text, uuid, jsonb)', 'fact_importacion_arca_confirmar(uuid, text[])',
    'fact_importacion_cerrar(uuid, text)', 'fact_comprobante_asociar(uuid, uuid, uuid, uuid, text)', 'fact_portal_registrar(uuid, jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Ciclo ARCA: sólo el servidor (service_role).
  foreach f in array array['fact_emision_iniciar_envio(uuid, bigint, jsonb)',
    'fact_emision_resultado(uuid, text, jsonb, text, date, date, text)', 'fact_emision_consulta(uuid, boolean, jsonb, text, date, date, bigint, bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end
$do$;
revoke all on function public.fact_emision_autorizar_interno(public.fact_emisiones, text, date, date, jsonb) from public, anon, authenticated;
revoke all on function public.fact_comprobante_inmutable() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
