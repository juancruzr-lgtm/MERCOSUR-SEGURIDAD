-- ═══════════════════════════════════════════════════════════════════════════
-- SIN APLICAR · requiere aprobación expresa de Gerencia
-- Gestión documental empresarial, habilitaciones, tareas administrativas,
-- reclamos de clientes e informes mensuales versionados.
-- (orden maestra integral 17/11/2026 · docs/gestion-empresarial/README.md)
--
-- Complementa lo existente, no lo reemplaza:
--  - Documentación del PERSONAL sigue en documentacion_* (legajo).
--  - Credencial del vigilador sigue en habilitacion_*.
--  - Clientes/contratos siguen en fact_clientes / fact_contratos.
--
-- Qué agrega:
--  - gestion_proveedores (no existía ninguna tabla de proveedores).
--  - gestion_obligaciones: catálogo de obligaciones con FUENTE. Las legales
--    sin texto oficial confirmado quedan 'pendiente_validacion'.
--  - gestion_documentos (+ eventos): documentos de empresa, clientes,
--    objetivos, proveedores y vehículos. Versionados por cadena reemplaza_a;
--    nunca se borran (trigger). Archivo en bucket privado 'gestion-documentos'
--    SIN políticas de storage: sólo URLs firmadas desde el servidor.
--  - gestion_seguimientos: estado de cada obligación por titular. VIGENCIA
--    (documento validado + vencimiento) y TRÁMITE (sin_tramite → iniciado →
--    presentado → aprobado/rechazado) son columnas distintas. Aprobar exige
--    documento aprobado y validación de Gerencia o Administración.
--  - gestion_responsables: titular y reemplazo por función (sin personas
--    precargadas: se asignan con confirmación de Gerencia).
--  - gestion_tareas_admin (+ eventos): pendientes administrativos con
--    responsable, plazo y estado.
--  - gestion_reclamos: reclamos de clientes, vinculables a gestion_casos.
--  - gestion_informes_mensuales: cierres mensuales inmutables por versión.
--  - gestion_recordatorios_config: avisos 90/60/30/15/0 configurables,
--    APAGADOS. Esta migración no programa cron ni envía nada.
--
-- Rollback: supabase/rollback/20261216120000_gestion_documental_administracion_rollback.sql
-- Verificación: supabase/verificacion/20261216120000_gestion_documental_administracion.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.puede_acceder_gerencia_actual()') is null
     or to_regprocedure('public.legajo_puede_gestionar()') is null
     or to_regprocedure('public.rondas_usuario_actual_id()') is null
     or to_regprocedure('public.acceso_habilitado_actual()') is null then
    raise exception 'Dependencias faltantes: puede_acceder_gerencia_actual / legajo_puede_gestionar / rondas_usuario_actual_id / acceso_habilitado_actual';
  end if;
end $$;

-- ── Acceso ──────────────────────────────────────────────────────────────────
-- Administración y Gerencia (misma regla que los datos personales del
-- legajo). Supervisión y Dirección Operativa NO acceden a esta documentación.
create or replace function public.gestion_admin_puede()
returns boolean language sql stable security definer set search_path = public, pg_catalog
as $$ select public.acceso_habilitado_actual() and (public.puede_acceder_gerencia_actual() or public.legajo_puede_gestionar()) $$;

create or replace function public.gestion_es_gerencia()
returns boolean language sql stable security definer set search_path = public, pg_catalog
as $$ select public.acceso_habilitado_actual() and public.puede_acceder_gerencia_actual() $$;

revoke all on function public.gestion_admin_puede() from public, anon;
revoke all on function public.gestion_es_gerencia() from public, anon;
grant execute on function public.gestion_admin_puede() to authenticated;
grant execute on function public.gestion_es_gerencia() to authenticated;

-- ── Proveedores ─────────────────────────────────────────────────────────────
create table public.gestion_proveedores (
  id           uuid primary key default gen_random_uuid(),
  razon_social text not null check (length(trim(razon_social)) > 0),
  cuit         text unique check (cuit is null or cuit ~ '^\d{11}$'),
  rubro        text,
  contacto     text,
  estado       text not null default 'activo' check (estado in ('activo', 'inactivo')),
  creado_por   uuid references public.usuarios(id),
  created_at   timestamptz not null default now()
);

-- ── Catálogo de obligaciones ────────────────────────────────────────────────
create table public.gestion_obligaciones (
  codigo                text primary key,
  nombre                text not null,
  ambito                text not null check (ambito in ('empresa', 'personal', 'cliente', 'objetivo', 'proveedor', 'vehiculo')),
  tipo_fuente           text not null check (tipo_fuente in ('legal', 'contractual', 'interna')),
  jurisdiccion          text,
  norma                 text,
  fuente_url            text,
  verificado_at         date,
  validacion            text not null default 'pendiente_validacion' check (validacion in ('confirmada', 'pendiente_validacion')),
  nota_validacion       text,
  periodicidad_meses    integer check (periodicidad_meses is null or periodicidad_meses > 0),
  dias_aviso            integer[] not null default '{90,60,30,15,0}',
  documentos_requeridos text[] not null default '{}',
  activo                boolean not null default true,
  check (tipo_fuente <> 'legal' or validacion = 'pendiente_validacion' or (norma is not null and fuente_url is not null and verificado_at is not null))
);
comment on table public.gestion_obligaciones is
  'Obligaciones documentales. Una legal "confirmada" exige norma, fuente oficial y fecha de verificación. Los días de aviso son configurables, no legales.';

-- Ley 14.420 de Santa Fe (BO 02/12/2025) y normas nacionales. Ver
-- docs/gestion-empresarial/normativa-fuentes.md. Lo que la ley deja a la
-- reglamentación (no hallada al 17/11/2026) queda sin periodicidad.
insert into public.gestion_obligaciones (codigo, nombre, ambito, tipo_fuente, jurisdiccion, norma, fuente_url, verificado_at, validacion, nota_validacion, periodicidad_meses, documentos_requeridos) values
  ('SF-HAB-EMPRESA', 'Habilitación de la prestadora e inscripción en el Registro de Prestadores', 'empresa', 'legal', 'Santa Fe', 'Ley 14.420 arts. 5, 12 y 15', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', 'Vigencia 5 años renovable.', 60, '{"certificado de habilitación"}'),
  ('SF-ADECUACION', 'Adecuación al régimen de la Ley 14.420 (prestadoras existentes)', 'empresa', 'legal', 'Santa Fe', 'Ley 14.420 art. 65', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', 'Plazo de 1 año desde la entrada en vigencia: fecha exacta a confirmar con el Ministerio (estimada diciembre 2026).', null, '{}'),
  ('SF-SEGURO-RC', 'Seguro de responsabilidad civil de servicios de seguridad privada', 'empresa', 'legal', 'Santa Fe', 'Ley 14.420 arts. 12 inc. d y 16', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', 'Monto mínimo lo fija la Autoridad. Vigencia según póliza.', 12, '{"póliza","certificado de cobertura"}'),
  ('SF-DIRECTOR-TECNICO', 'Director Técnico autorizado', 'empresa', 'legal', 'Santa Fe', 'Ley 14.420 arts. 22 a 24', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', 'Vacancia: interino en 5 días hábiles y titular en 30.', null, '{"autorización del Director Técnico"}'),
  ('SF-PREVISIONAL-ANUAL', 'Acreditación anual de cumplimiento previsional', 'empresa', 'legal', 'Santa Fe', 'Ley 14.420 art. 13 inc. h', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', null, 12, '{"constancia previsional"}'),
  ('SF-NOVEDADES-AUTORIDAD', 'Aviso a la Autoridad de altas/bajas de objetivos, personal, vehículos y armas', 'empresa', 'legal', 'Santa Fe', 'Ley 14.420 art. 13 inc. d', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', 'Plazo pendiente de reglamentación.', null, '{"constancia de presentación"}'),
  ('SF-CREDENCIAL', 'Credencial habilitante del vigilador', 'personal', 'legal', 'Santa Fe', 'Ley 14.420 art. 19 inc. j', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', 'Se gestiona en habilitacion_*; vigencia pendiente de reglamentación.', null, '{}'),
  ('SF-CERT-CLIENTE', 'Certificado anual de habilitación para el cliente', 'cliente', 'legal', 'Santa Fe', 'Ley 14.420 arts. 8, 31 y 32', 'https://www.santafe.gob.ar/boletinoficial/ver.php?seccion=2025/2025-12-02ley14420.html', '2026-11-17', 'confirmada', 'Lo pide el cliente a la Autoridad; conviene tenerlo listo.', 12, '{"certificado de habilitación"}'),
  ('ER-HAB-EMPRESA', 'Habilitación de la agencia en Entre Ríos', 'empresa', 'legal', 'Entre Ríos', null, null, null, 'pendiente_validacion', 'Decretos 2940/01 y 4040/12 según fuente no oficial; habilitación anual. Confirmar texto oficial.', 12, '{}'),
  ('NAC-ART', 'Contrato con ART vigente', 'empresa', 'legal', 'Nacional', 'Ley 24.557 art. 3', 'https://servicios.infoleg.gob.ar/infolegInternet/anexos/25000-29999/27971/texact.htm', '2026-11-17', 'confirmada', null, 12, '{"contrato ART","certificado de cobertura"}'),
  ('NAC-SEGURO-VIDA', 'Seguro colectivo de vida obligatorio', 'empresa', 'legal', 'Nacional', 'Decreto 1567/74', 'https://www.argentina.gob.ar/economia/inclusion-financiera/cuales-son-los-seguros-obligatorios-que-debo-contratar-para-mi-empresa', '2026-11-17', 'confirmada', 'Póliza anual.', 12, '{"póliza"}'),
  ('NAC-F931', 'Declaración jurada F.931 y pago de cargas sociales', 'empresa', 'legal', 'Nacional', 'RG DGI 3834/94 y modificatorias', 'https://servicios.infoleg.gob.ar/infolegInternet/anexos/60000-64999/60834/texact.htm', '2026-11-17', 'confirmada', 'Presentación mensual: se registra como tarea periódica, no como documento con vencimiento.', 1, '{"acuse F.931"}'),
  ('NAC-ALTA-TEMPRANA-CLIENTE', 'Acuse de alta del trabajador para el cliente', 'cliente', 'legal', 'Nacional', 'RG AFIP 2988/2010', 'https://www.argentina.gob.ar/normativa/nacional/norma-176246/actualizacion', '2026-11-17', 'confirmada', 'Antes de cada inicio de prestación en el establecimiento del cliente.', null, '{"acuse de alta"}'),
  ('CLI-REQUISITOS', 'Requisitos documentales del contrato del cliente', 'cliente', 'contractual', null, null, null, null, 'pendiente_validacion', 'Tomar de fact_contratos.requisitos y del pliego/contrato de cada cliente.', null, '{}'),
  ('PROV-CONSTANCIA', 'Constancia fiscal y seguros del proveedor', 'proveedor', 'interna', null, null, null, null, 'pendiente_validacion', 'Definir con Administración qué se exige a cada proveedor.', 12, '{"constancia de inscripción"}'),
  ('VEH-SEGURO', 'Seguro y documentación del vehículo', 'vehiculo', 'interna', null, null, null, null, 'pendiente_validacion', 'Confirmar flota y exigencias.', 12, '{"póliza","cédula"}');

-- ── Responsables por función (titular y reemplazo) ──────────────────────────
create table public.gestion_responsables (
  funcion      text primary key check (funcion in ('gerencia', 'administracion', 'documental', 'jefe_supervisores', 'director_tecnico', 'facturacion', 'liquidacion')),
  titular_id   uuid references public.usuarios(id),
  reemplazo_id uuid references public.usuarios(id),
  confirmado_por uuid references public.usuarios(id),
  confirmado_at  timestamptz
);
insert into public.gestion_responsables (funcion) values
  ('gerencia'), ('administracion'), ('documental'), ('jefe_supervisores'), ('director_tecnico'), ('facturacion'), ('liquidacion');

-- ── Documentos ──────────────────────────────────────────────────────────────
create table public.gestion_documentos (
  id                uuid primary key default gen_random_uuid(),
  titular_tipo      text not null check (titular_tipo in ('empresa', 'cliente', 'objetivo', 'proveedor', 'vehiculo')),
  titular_id        uuid,              -- null = la empresa; cliente → fact_clientes, objetivo → objetivos, proveedor → gestion_proveedores
  tipo              text not null,
  obligacion_codigo text references public.gestion_obligaciones(codigo),
  organismo         text,
  numero            text,
  fecha_emision     date,
  vence_el          date,
  responsable_id    uuid references public.usuarios(id),
  storage_path      text,
  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  mime              text,
  bytes             bigint,
  sensibilidad      text not null default 'administracion' check (sensibilidad in ('administracion', 'reservado_gerencia')),
  estado_revision   text not null default 'pendiente' check (estado_revision in ('pendiente', 'aprobado', 'observado', 'rechazado')),
  revisado_por      uuid references public.usuarios(id),
  revisado_at       timestamptz,
  version           integer not null default 1 check (version > 0),
  reemplaza_a       uuid references public.gestion_documentos(id),
  reemplazado_por   uuid references public.gestion_documentos(id),
  anulado_por       uuid references public.usuarios(id),
  anulado_at        timestamptz,
  motivo_anulacion  text,
  observaciones     text,
  creado_por        uuid not null references public.usuarios(id),
  created_at        timestamptz not null default now(),
  check ((titular_tipo = 'empresa') = (titular_id is null)),
  check (vence_el is null or fecha_emision is null or vence_el >= fecha_emision),
  check (estado_revision = 'pendiente' or (revisado_por is not null and revisado_at is not null)),
  check (anulado_at is null or (anulado_por is not null and length(trim(coalesce(motivo_anulacion, ''))) > 0))
);
create index gestion_documentos_titular_idx on public.gestion_documentos (titular_tipo, titular_id);
create index gestion_documentos_vence_idx on public.gestion_documentos (vence_el) where anulado_at is null and reemplazado_por is null;

create table public.gestion_documento_eventos (
  id           bigint generated always as identity primary key,
  documento_id uuid not null references public.gestion_documentos(id),
  accion       text not null check (accion in ('registrado', 'revisado', 'reemplazado', 'anulado', 'abierto')),
  detalle      jsonb not null default '{}'::jsonb,
  actor_id     uuid references public.usuarios(id),
  at           timestamptz not null default now()
);

-- ── Seguimiento por obligación y titular ────────────────────────────────────
create table public.gestion_seguimientos (
  id                    uuid primary key default gen_random_uuid(),
  obligacion_codigo     text not null references public.gestion_obligaciones(codigo),
  titular_tipo          text not null check (titular_tipo in ('empresa', 'cliente', 'objetivo', 'proveedor', 'vehiculo')),
  titular_id            uuid,
  responsable_id        uuid references public.usuarios(id),
  reemplazo_id          uuid references public.usuarios(id),
  documento_vigente_id  uuid references public.gestion_documentos(id),
  vence_el              date,
  tramite               text not null default 'sin_tramite' check (tramite in ('sin_tramite', 'iniciado', 'presentado', 'aprobado', 'rechazado')),
  tramite_iniciado_at   timestamptz,
  presentado_at         timestamptz,
  faltantes             text[] not null default '{}',
  resultado             text,
  validado_por          uuid references public.usuarios(id),
  validado_at           timestamptz,
  ultimo_movimiento_at  timestamptz,
  version               integer not null default 1,
  check ((titular_tipo = 'empresa') = (titular_id is null)),
  check (documento_vigente_id is null or (validado_por is not null and validado_at is not null))
);
create unique index gestion_seguimientos_unico on public.gestion_seguimientos (obligacion_codigo, titular_tipo, coalesce(titular_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.gestion_seguimiento_eventos (
  id             bigint generated always as identity primary key,
  seguimiento_id uuid not null references public.gestion_seguimientos(id),
  operacion_id   uuid not null unique,
  accion         text not null,
  tramite_antes  text,
  tramite_despues text,
  detalle        jsonb not null default '{}'::jsonb,
  actor_id       uuid not null references public.usuarios(id),
  at             timestamptz not null default now()
);

-- ── Tareas administrativas ──────────────────────────────────────────────────
create table public.gestion_tareas_admin (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null check (length(trim(titulo)) > 0),
  detalle        text,
  proceso        text not null check (proceso in ('incorporacion', 'legajos', 'clientes_contratos', 'facturacion', 'liquidacion', 'obligaciones', 'inspecciones', 'proveedores', 'otro')),
  entidad_tipo   text,
  entidad_id     uuid,
  seguimiento_id uuid references public.gestion_seguimientos(id),
  responsable_id uuid references public.usuarios(id),
  reemplazo_id   uuid references public.usuarios(id),
  plazo          date,
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'en_curso', 'esperando_tercero', 'resuelta', 'cancelada')),
  origen         text not null default 'manual' check (origen in ('manual', 'vencimiento', 'documento_faltante', 'requerimiento', 'reclamo')),
  resultado      text,
  creado_por     uuid not null references public.usuarios(id),
  created_at     timestamptz not null default now(),
  resuelta_por   uuid references public.usuarios(id),
  resuelta_at    timestamptz,
  version        integer not null default 1,
  check (estado not in ('resuelta', 'cancelada') or (resuelta_por is not null and resuelta_at is not null and length(trim(coalesce(resultado, ''))) > 0))
);

create table public.gestion_tarea_eventos (
  id           bigint generated always as identity primary key,
  tarea_id     uuid not null references public.gestion_tareas_admin(id),
  operacion_id uuid not null unique,
  accion       text not null,
  estado_antes text,
  estado_despues text,
  comentario   text,
  actor_id     uuid not null references public.usuarios(id),
  at           timestamptz not null default now()
);

-- ── Reclamos de clientes ────────────────────────────────────────────────────
create table public.gestion_reclamos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid,
  objetivo_id  uuid references public.objetivos(id),
  fecha        date not null,
  recibido_at  timestamptz not null default now(),
  canal        text not null check (canal in ('telefono', 'whatsapp', 'email', 'nota', 'reunion', 'otro')),
  descripcion  text not null check (length(trim(descripcion)) > 0),
  gravedad     text not null default 'media' check (gravedad in ('baja', 'media', 'alta', 'critica')),
  caso_id      uuid,               -- gestion_casos.id si la migración 20261215120000 está aplicada
  estado       text not null default 'abierto' check (estado in ('abierto', 'en_gestion', 'respondido', 'cerrado')),
  respuesta    text,
  registrado_por uuid not null references public.usuarios(id),
  cerrado_por  uuid references public.usuarios(id),
  cerrado_at   timestamptz
);

-- ── Informes mensuales versionados ──────────────────────────────────────────
create table public.gestion_informes_mensuales (
  id           uuid primary key default gen_random_uuid(),
  mes          text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  version      integer not null check (version > 0),
  contenido    jsonb not null,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  motivo       text,
  generado_por uuid not null references public.usuarios(id),
  generado_at  timestamptz not null default now(),
  unique (mes, version),
  check (version = 1 or length(trim(coalesce(motivo, ''))) > 0)
);
comment on table public.gestion_informes_mensuales is
  'Cierres mensuales inmutables. Una corrección es una versión nueva con motivo; la anterior queda intacta.';

-- ── Recordatorios (apagados) ────────────────────────────────────────────────
create table public.gestion_recordatorios_config (
  id               boolean primary key default true check (id),
  activo           boolean not null default false,
  dias_aviso       integer[] not null default '{90,60,30,15,0}',
  escalar_dias     integer not null default 30,
  canal            text not null default 'ninguno' check (canal in ('ninguno', 'push', 'whatsapp')),
  actualizado_por  uuid references public.usuarios(id),
  actualizado_at   timestamptz
);
insert into public.gestion_recordatorios_config default values;

-- ── Inmutabilidad ───────────────────────────────────────────────────────────
create or replace function public.gestion_bloquear_borrado()
returns trigger language plpgsql as $$
begin
  raise exception 'No se borran registros de %: se anulan o se reemplazan', tg_table_name;
end $$;

create or replace function public.gestion_bloquear_cambio()
returns trigger language plpgsql as $$
begin
  raise exception '% es de sólo agregado', tg_table_name;
end $$;

create trigger gestion_documentos_sin_borrado before delete on public.gestion_documentos for each row execute function public.gestion_bloquear_borrado();
create trigger gestion_seguimientos_sin_borrado before delete on public.gestion_seguimientos for each row execute function public.gestion_bloquear_borrado();
create trigger gestion_tareas_sin_borrado before delete on public.gestion_tareas_admin for each row execute function public.gestion_bloquear_borrado();
create trigger gestion_reclamos_sin_borrado before delete on public.gestion_reclamos for each row execute function public.gestion_bloquear_borrado();
create trigger gestion_doc_eventos_inmutables before update or delete on public.gestion_documento_eventos for each row execute function public.gestion_bloquear_cambio();
create trigger gestion_seg_eventos_inmutables before update or delete on public.gestion_seguimiento_eventos for each row execute function public.gestion_bloquear_cambio();
create trigger gestion_tarea_eventos_inmutables before update or delete on public.gestion_tarea_eventos for each row execute function public.gestion_bloquear_cambio();
create trigger gestion_informes_inmutables before update or delete on public.gestion_informes_mensuales for each row execute function public.gestion_bloquear_cambio();

-- Un documento sólo cambia por revisión, reemplazo o anulación (RPC). Los
-- datos de origen (titular, archivo, hash, fechas) no se reescriben.
create or replace function public.gestion_documento_proteger()
returns trigger language plpgsql as $$
begin
  if (new.titular_tipo, new.titular_id, new.tipo, new.storage_path, new.sha256, new.fecha_emision, new.vence_el, new.version, new.reemplaza_a, new.creado_por, new.created_at)
     is distinct from
     (old.titular_tipo, old.titular_id, old.tipo, old.storage_path, old.sha256, old.fecha_emision, old.vence_el, old.version, old.reemplaza_a, old.creado_por, old.created_at) then
    raise exception 'Los datos de origen de un documento no se modifican: registrá una versión nueva';
  end if;
  return new;
end $$;
create trigger gestion_documentos_proteger before update on public.gestion_documentos for each row execute function public.gestion_documento_proteger();

-- ── RLS: lectura por permiso, ninguna escritura directa ─────────────────────
alter table public.gestion_proveedores enable row level security;
alter table public.gestion_obligaciones enable row level security;
alter table public.gestion_responsables enable row level security;
alter table public.gestion_documentos enable row level security;
alter table public.gestion_documento_eventos enable row level security;
alter table public.gestion_seguimientos enable row level security;
alter table public.gestion_seguimiento_eventos enable row level security;
alter table public.gestion_tareas_admin enable row level security;
alter table public.gestion_tarea_eventos enable row level security;
alter table public.gestion_reclamos enable row level security;
alter table public.gestion_informes_mensuales enable row level security;
alter table public.gestion_recordatorios_config enable row level security;

create policy "Gestion admin: proveedores" on public.gestion_proveedores for select to authenticated using (public.gestion_admin_puede());
create policy "Gestion admin: obligaciones" on public.gestion_obligaciones for select to authenticated using (public.gestion_admin_puede());
create policy "Gestion admin: responsables" on public.gestion_responsables for select to authenticated using (public.gestion_admin_puede());
create policy "Gestion admin: documentos" on public.gestion_documentos for select to authenticated
  using (public.gestion_admin_puede() and (sensibilidad <> 'reservado_gerencia' or public.gestion_es_gerencia()));
create policy "Gestion admin: eventos de documentos" on public.gestion_documento_eventos for select to authenticated
  using (exists (select 1 from public.gestion_documentos d where d.id = documento_id));
create policy "Gestion admin: seguimientos" on public.gestion_seguimientos for select to authenticated using (public.gestion_admin_puede());
create policy "Gestion admin: eventos de seguimientos" on public.gestion_seguimiento_eventos for select to authenticated using (public.gestion_admin_puede());
create policy "Gestion admin: tareas" on public.gestion_tareas_admin for select to authenticated
  using (public.gestion_admin_puede() or responsable_id = public.rondas_usuario_actual_id() or reemplazo_id = public.rondas_usuario_actual_id());
create policy "Gestion admin: eventos de tareas" on public.gestion_tarea_eventos for select to authenticated
  using (exists (select 1 from public.gestion_tareas_admin t where t.id = tarea_id));
create policy "Gestion admin: reclamos" on public.gestion_reclamos for select to authenticated using (public.gestion_es_gerencia() or public.gestion_admin_puede());
create policy "Gestion admin: informes" on public.gestion_informes_mensuales for select to authenticated using (public.gestion_es_gerencia());
create policy "Gestion admin: recordatorios" on public.gestion_recordatorios_config for select to authenticated using (public.gestion_admin_puede());

revoke insert, update, delete on public.gestion_proveedores, public.gestion_obligaciones, public.gestion_responsables,
  public.gestion_documentos, public.gestion_documento_eventos, public.gestion_seguimientos, public.gestion_seguimiento_eventos,
  public.gestion_tareas_admin, public.gestion_tarea_eventos, public.gestion_reclamos, public.gestion_informes_mensuales,
  public.gestion_recordatorios_config from authenticated, anon;
grant select on public.gestion_proveedores, public.gestion_obligaciones, public.gestion_responsables,
  public.gestion_documentos, public.gestion_documento_eventos, public.gestion_seguimientos, public.gestion_seguimiento_eventos,
  public.gestion_tareas_admin, public.gestion_tarea_eventos, public.gestion_reclamos, public.gestion_informes_mensuales,
  public.gestion_recordatorios_config to authenticated;

-- ── RPC: registrar documento (después de subir el archivo por la API) ───────
create or replace function public.gestion_documento_registrar(
  p_titular_tipo text, p_titular_id uuid, p_tipo text, p_obligacion_codigo text,
  p_fecha_emision date, p_vence_el date, p_storage_path text, p_sha256 text, p_mime text, p_bytes bigint,
  p_sensibilidad text default 'administracion', p_organismo text default null, p_numero text default null,
  p_reemplaza_a uuid default null, p_observaciones text default null
) returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_yo uuid := public.rondas_usuario_actual_id();
  v_id uuid;
  v_version integer := 1;
  v_prev public.gestion_documentos;
begin
  if v_yo is null or not public.gestion_admin_puede() then raise exception 'Sin permiso para registrar documentación'; end if;
  if p_sensibilidad = 'reservado_gerencia' and not public.gestion_es_gerencia() then raise exception 'Sólo Gerencia registra documentos reservados'; end if;
  if p_storage_path is null or p_storage_path not like 'gestion/%' then raise exception 'Ruta de archivo inválida'; end if;
  if p_reemplaza_a is not null then
    select * into v_prev from public.gestion_documentos where id = p_reemplaza_a for update;
    if not found then raise exception 'Documento a reemplazar inexistente'; end if;
    if v_prev.reemplazado_por is not null or v_prev.anulado_at is not null then raise exception 'Ese documento ya fue reemplazado o anulado'; end if;
    if (v_prev.titular_tipo, v_prev.titular_id, v_prev.tipo) is distinct from (p_titular_tipo, p_titular_id, p_tipo) then
      raise exception 'Una versión nueva debe ser del mismo titular y tipo';
    end if;
    v_version := v_prev.version + 1;
  end if;
  insert into public.gestion_documentos (titular_tipo, titular_id, tipo, obligacion_codigo, organismo, numero, fecha_emision, vence_el,
    storage_path, sha256, mime, bytes, sensibilidad, version, reemplaza_a, observaciones, creado_por)
  values (p_titular_tipo, p_titular_id, p_tipo, p_obligacion_codigo, p_organismo, p_numero, p_fecha_emision, p_vence_el,
    p_storage_path, p_sha256, p_mime, p_bytes, coalesce(p_sensibilidad, 'administracion'), v_version, p_reemplaza_a, p_observaciones, v_yo)
  returning id into v_id;
  if p_reemplaza_a is not null then
    update public.gestion_documentos set reemplazado_por = v_id where id = p_reemplaza_a;
    insert into public.gestion_documento_eventos (documento_id, accion, detalle, actor_id) values (p_reemplaza_a, 'reemplazado', jsonb_build_object('por', v_id), v_yo);
  end if;
  insert into public.gestion_documento_eventos (documento_id, accion, detalle, actor_id) values (v_id, 'registrado', jsonb_build_object('version', v_version), v_yo);
  return v_id;
end $$;

-- ── RPC: revisar documento ──────────────────────────────────────────────────
create or replace function public.gestion_documento_revisar(p_documento_id uuid, p_resultado text, p_comentario text default null)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_doc public.gestion_documentos;
begin
  if v_yo is null or not public.gestion_admin_puede() then raise exception 'Sin permiso para revisar documentación'; end if;
  if p_resultado not in ('aprobado', 'observado', 'rechazado') then raise exception 'Resultado inválido'; end if;
  if p_resultado <> 'aprobado' and length(trim(coalesce(p_comentario, ''))) = 0 then raise exception 'Observar o rechazar exige un comentario'; end if;
  select * into v_doc from public.gestion_documentos where id = p_documento_id for update;
  if not found then raise exception 'Documento inexistente'; end if;
  if v_doc.anulado_at is not null then raise exception 'Documento anulado'; end if;
  if v_doc.creado_por = v_yo and not public.gestion_es_gerencia() then raise exception 'Quien sube el documento no puede aprobarlo'; end if;
  update public.gestion_documentos set estado_revision = p_resultado, revisado_por = v_yo, revisado_at = now(),
    observaciones = coalesce(nullif(trim(p_comentario), ''), observaciones) where id = p_documento_id;
  insert into public.gestion_documento_eventos (documento_id, accion, detalle, actor_id)
    values (p_documento_id, 'revisado', jsonb_build_object('resultado', p_resultado, 'comentario', p_comentario), v_yo);
end $$;

-- ── RPC: trámite de una obligación (espejo de lib/gestion-admin/obligaciones.ts)
create or replace function public.gestion_seguimiento_accion(
  p_operacion_id uuid, p_seguimiento_id uuid, p_accion text, p_version integer,
  p_documento_id uuid default null, p_nuevo_vencimiento date default null, p_faltantes text[] default null, p_motivo text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_yo uuid := public.rondas_usuario_actual_id();
  v_s public.gestion_seguimientos;
  v_o public.gestion_obligaciones;
  v_destino text;
  v_doc public.gestion_documentos;
begin
  if v_yo is null or not public.gestion_admin_puede() then raise exception 'Sin permiso'; end if;
  if exists (select 1 from public.gestion_seguimiento_eventos where operacion_id = p_operacion_id) then
    return jsonb_build_object('ok', true, 'duplicada', true);
  end if;
  select * into v_s from public.gestion_seguimientos where id = p_seguimiento_id for update;
  if not found then raise exception 'Seguimiento inexistente'; end if;
  if v_s.version <> p_version then return jsonb_build_object('ok', false, 'error', 'conflicto', 'version', v_s.version); end if;
  select * into v_o from public.gestion_obligaciones where codigo = v_s.obligacion_codigo;

  v_destino := case p_accion when 'iniciar' then 'iniciado' when 'presentar' then 'presentado' when 'aprobar' then 'aprobado'
    when 'rechazar' then 'rechazado' when 'cancelar' then 'sin_tramite' else null end;
  if v_destino is null then raise exception 'Acción inválida'; end if;
  if not (
    (v_s.tramite = 'sin_tramite' and v_destino = 'iniciado') or
    (v_s.tramite = 'iniciado' and v_destino in ('presentado', 'sin_tramite')) or
    (v_s.tramite = 'presentado' and v_destino in ('aprobado', 'rechazado')) or
    (v_s.tramite = 'rechazado' and v_destino = 'iniciado') or
    (v_s.tramite = 'aprobado' and v_destino = 'iniciado')
  ) then raise exception 'No se puede pasar de "%" a "%"', v_s.tramite, v_destino; end if;
  if p_accion in ('rechazar', 'cancelar') and length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Falta el motivo'; end if;

  if p_accion = 'aprobar' then
    select * into v_doc from public.gestion_documentos where id = p_documento_id;
    if not found or v_doc.estado_revision <> 'aprobado' or v_doc.anulado_at is not null then
      raise exception 'La renovación necesita el documento aprobado: subir un archivo no alcanza';
    end if;
    if v_o.periodicidad_meses is not null and p_nuevo_vencimiento is null then raise exception 'Falta el nuevo vencimiento'; end if;
    if p_nuevo_vencimiento is not null and v_s.vence_el is not null and p_nuevo_vencimiento <= v_s.vence_el then
      raise exception 'El nuevo vencimiento debe ser posterior al anterior';
    end if;
    update public.gestion_seguimientos set tramite = 'aprobado', documento_vigente_id = v_doc.id, vence_el = p_nuevo_vencimiento,
      validado_por = v_yo, validado_at = now(), faltantes = '{}', ultimo_movimiento_at = now(), version = version + 1
      where id = v_s.id;
  else
    update public.gestion_seguimientos set tramite = v_destino,
      tramite_iniciado_at = case when v_destino = 'iniciado' then now() else tramite_iniciado_at end,
      presentado_at = case when v_destino = 'presentado' then now() when v_destino = 'iniciado' then null else presentado_at end,
      faltantes = coalesce(p_faltantes, faltantes), resultado = coalesce(p_motivo, resultado),
      ultimo_movimiento_at = now(), version = version + 1
      where id = v_s.id;
  end if;
  insert into public.gestion_seguimiento_eventos (seguimiento_id, operacion_id, accion, tramite_antes, tramite_despues, detalle, actor_id)
    values (v_s.id, p_operacion_id, p_accion, v_s.tramite, v_destino,
      jsonb_strip_nulls(jsonb_build_object('documento', p_documento_id, 'vence', p_nuevo_vencimiento, 'motivo', p_motivo, 'faltantes', p_faltantes)), v_yo);
  return jsonb_build_object('ok', true, 'tramite', v_destino, 'version', v_s.version + 1);
end $$;

-- ── RPC: tareas administrativas ─────────────────────────────────────────────
create or replace function public.gestion_tarea_accion(
  p_operacion_id uuid, p_tarea_id uuid, p_accion text, p_version integer, p_comentario text default null, p_responsable_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_t public.gestion_tareas_admin; v_destino text;
begin
  if v_yo is null then raise exception 'Sin sesión'; end if;
  if exists (select 1 from public.gestion_tarea_eventos where operacion_id = p_operacion_id) then return jsonb_build_object('ok', true, 'duplicada', true); end if;
  select * into v_t from public.gestion_tareas_admin where id = p_tarea_id for update;
  if not found then raise exception 'Tarea inexistente'; end if;
  if not (public.gestion_admin_puede() or v_t.responsable_id = v_yo or v_t.reemplazo_id = v_yo) then raise exception 'Sin permiso sobre esta tarea'; end if;
  if v_t.version <> p_version then return jsonb_build_object('ok', false, 'error', 'conflicto', 'version', v_t.version); end if;
  if v_t.estado in ('resuelta', 'cancelada') and p_accion <> 'reabrir' then raise exception 'La tarea está cerrada'; end if;
  v_destino := case p_accion when 'tomar' then 'en_curso' when 'esperar_tercero' then 'esperando_tercero' when 'resolver' then 'resuelta'
    when 'cancelar' then 'cancelada' when 'reabrir' then 'pendiente' when 'asignar' then v_t.estado when 'comentar' then v_t.estado else null end;
  if v_destino is null then raise exception 'Acción inválida'; end if;
  if p_accion in ('resolver', 'cancelar', 'reabrir') and length(trim(coalesce(p_comentario, ''))) = 0 then raise exception 'Falta el comentario'; end if;
  if p_accion = 'asignar' and not public.gestion_admin_puede() then raise exception 'Sólo Administración o Gerencia asignan'; end if;
  update public.gestion_tareas_admin set estado = v_destino,
    responsable_id = case when p_accion = 'asignar' then p_responsable_id else responsable_id end,
    resultado = case when p_accion in ('resolver', 'cancelar') then p_comentario when p_accion = 'reabrir' then null else resultado end,
    resuelta_por = case when v_destino in ('resuelta', 'cancelada') then v_yo when p_accion = 'reabrir' then null else resuelta_por end,
    resuelta_at = case when v_destino in ('resuelta', 'cancelada') then now() when p_accion = 'reabrir' then null else resuelta_at end,
    version = version + 1
  where id = v_t.id;
  insert into public.gestion_tarea_eventos (tarea_id, operacion_id, accion, estado_antes, estado_despues, comentario, actor_id)
    values (v_t.id, p_operacion_id, p_accion, v_t.estado, v_destino, p_comentario, v_yo);
  return jsonb_build_object('ok', true, 'estado', v_destino, 'version', v_t.version + 1);
end $$;

create or replace function public.gestion_tarea_crear(
  p_titulo text, p_proceso text, p_plazo date default null, p_responsable_id uuid default null, p_detalle text default null,
  p_entidad_tipo text default null, p_entidad_id uuid default null, p_seguimiento_id uuid default null, p_origen text default 'manual'
) returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_id uuid;
begin
  if v_yo is null or not public.gestion_admin_puede() then raise exception 'Sin permiso'; end if;
  insert into public.gestion_tareas_admin (titulo, detalle, proceso, entidad_tipo, entidad_id, seguimiento_id, responsable_id, plazo, origen, creado_por)
    values (p_titulo, p_detalle, p_proceso, p_entidad_tipo, p_entidad_id, p_seguimiento_id, p_responsable_id, p_plazo, p_origen, v_yo)
    returning id into v_id;
  return v_id;
end $$;

-- ── RPC: reclamos ───────────────────────────────────────────────────────────
create or replace function public.gestion_reclamo_registrar(
  p_fecha date, p_canal text, p_descripcion text, p_objetivo_id uuid default null, p_cliente_id uuid default null,
  p_gravedad text default 'media', p_caso_id uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_id uuid;
begin
  if v_yo is null or not (public.gestion_admin_puede() or public.gestion_es_gerencia()) then raise exception 'Sin permiso'; end if;
  insert into public.gestion_reclamos (cliente_id, objetivo_id, fecha, canal, descripcion, gravedad, caso_id, registrado_por)
    values (p_cliente_id, p_objetivo_id, p_fecha, p_canal, p_descripcion, p_gravedad, p_caso_id, v_yo) returning id into v_id;
  return v_id;
end $$;

-- ── RPC: guardar informe mensual (versión nueva, nunca reescribe) ───────────
create or replace function public.gestion_informe_guardar(p_mes text, p_contenido jsonb, p_sha256 text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_yo uuid := public.rondas_usuario_actual_id(); v_version integer;
begin
  if v_yo is null or not public.gestion_es_gerencia() then raise exception 'Sólo Gerencia guarda el cierre mensual'; end if;
  perform pg_advisory_xact_lock(hashtext('gestion_informe_' || p_mes));
  select coalesce(max(version), 0) + 1 into v_version from public.gestion_informes_mensuales where mes = p_mes;
  insert into public.gestion_informes_mensuales (mes, version, contenido, sha256, motivo, generado_por)
    values (p_mes, v_version, p_contenido, p_sha256, p_motivo, v_yo);
  return jsonb_build_object('ok', true, 'mes', p_mes, 'version', v_version);
end $$;

revoke all on function public.gestion_documento_registrar(text, uuid, text, text, date, date, text, text, text, bigint, text, text, text, uuid, text) from public, anon;
revoke all on function public.gestion_documento_revisar(uuid, text, text) from public, anon;
revoke all on function public.gestion_seguimiento_accion(uuid, uuid, text, integer, uuid, date, text[], text) from public, anon;
revoke all on function public.gestion_tarea_accion(uuid, uuid, text, integer, text, uuid) from public, anon;
revoke all on function public.gestion_tarea_crear(text, text, date, uuid, text, text, uuid, uuid, text) from public, anon;
revoke all on function public.gestion_reclamo_registrar(date, text, text, uuid, uuid, text, uuid) from public, anon;
revoke all on function public.gestion_informe_guardar(text, jsonb, text, text) from public, anon;
grant execute on function public.gestion_documento_registrar(text, uuid, text, text, date, date, text, text, text, bigint, text, text, text, uuid, text) to authenticated;
grant execute on function public.gestion_documento_revisar(uuid, text, text) to authenticated;
grant execute on function public.gestion_seguimiento_accion(uuid, uuid, text, integer, uuid, date, text[], text) to authenticated;
grant execute on function public.gestion_tarea_accion(uuid, uuid, text, integer, text, uuid) to authenticated;
grant execute on function public.gestion_tarea_crear(text, text, date, uuid, text, text, uuid, uuid, text) to authenticated;
grant execute on function public.gestion_reclamo_registrar(date, text, text, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.gestion_informe_guardar(text, jsonb, text, text) to authenticated;

-- ── Bucket privado (sin políticas: sólo URLs firmadas desde el servidor) ────
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('gestion-documentos', 'gestion-documentos', false)
    on conflict (id) do nothing;
  end if;
end $$;

commit;
