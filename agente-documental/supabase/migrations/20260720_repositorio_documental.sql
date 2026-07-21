-- ============================================================
-- AGENTE MERCOSUR — Repositorio Documental
-- Ejecutar manualmente en Supabase SQL Editor
-- No ejecutar automáticamente
-- ============================================================

-- La tabla NO tiene FK obligatorias con empleados, clientes ni objetivos.
-- Esas relaciones se incorporarán en etapas posteriores.
-- Diseñada para múltiples agentes sobre la misma base de datos.

create table if not exists repositorio_documental (

  -- ── Identidad ──────────────────────────────────────────────

  id uuid primary key default gen_random_uuid(),

  -- Identidad estable del documento a través del tiempo y las versiones.
  -- No cambia aunque el archivo se modifique o renombre.
  documento_uid uuid not null default gen_random_uuid(),

  -- Contador de versiones. Empieza en 1, sube con cada cambio de hash.
  -- Preparado para una tabla de historial de versiones en v2.
  version_actual integer not null default 1 check (version_actual >= 1),

  -- ── Origen ─────────────────────────────────────────────────

  -- Identifica qué agente detectó el documento.
  -- Único por máquina: 'notebook-juan', 'servidor-mpls', etc.
  -- Permite múltiples agentes sobre la misma base sin conflictos.
  agente_id text not null,

  -- Fuente lógica del documento.
  -- v1: 'local'. Futuro: 'sharepoint', 'mega', 'email', 'google-drive'.
  origen text not null default 'local',

  -- Empresa propietaria. Preparado para uso multi-empresa futuro.
  empresa text not null default 'mercosur-seguridad',

  -- ── Clasificación ──────────────────────────────────────────

  -- Tipo de documento detectado por IA en v2.
  -- Ejemplos: 'contrato', 'pliego', 'legajo', 'psicofisico', 'licencia'.
  -- null hasta que la IA lo clasifique.
  tipo_documento text,

  -- Categoría operativa. null hasta clasificación automática.
  categoria text,

  -- Etiquetas libres para búsqueda y filtrado. Vacío hasta clasificación.
  etiquetas text[] not null default '{}',

  -- ── Archivo ────────────────────────────────────────────────

  nombre_archivo text not null,
  extension text not null,     -- en minúsculas, con punto: '.pdf'
  mime_type text not null,

  -- Ruta relativa a DOCUMENT_ROOT_PATH.
  -- Dato operativo principal. Nunca se guarda la ruta absoluta.
  -- La ruta absoluta se reconstruye como: DOCUMENT_ROOT_PATH + '/' + ruta_relativa
  ruta_relativa text not null,

  tamano_bytes bigint not null default 0,

  -- Huella de contenido. Detecta modificaciones aunque el nombre no cambie.
  hash_sha256 text not null,

  -- ── Fechas del archivo ─────────────────────────────────────

  -- birthtime del filesystem. null en sistemas que no lo exponen.
  fecha_creacion_archivo timestamptz,

  -- mtime del filesystem.
  fecha_modificacion_archivo timestamptz not null,

  -- ── Detección ──────────────────────────────────────────────

  -- Primera vez que este agente detectó el archivo.
  detectado_por_primera_vez_at timestamptz not null default now(),

  -- Última vez que el agente confirmó su existencia.
  detectado_por_ultima_vez_at timestamptz not null default now(),

  -- ── Estado ─────────────────────────────────────────────────

  -- false cuando el archivo desaparece del disco. El registro nunca se borra.
  disponible boolean not null default true,

  -- Estado de la indexación / procesamiento.
  estado_indexacion text not null default 'indexado'
    check (estado_indexacion in ('indexado', 'pendiente', 'error', 'ignorado')),

  -- Descripción del último error de procesamiento, si hubo.
  ultimo_error text,

  -- ── Auditoría ──────────────────────────────────────────────

  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()

);

-- ── Restricciones ────────────────────────────────────────────

-- Un agente no puede duplicar la misma ruta relativa.
-- Esta constraint es el mecanismo central anti-duplicados:
-- el upsert sobre (agente_id, ruta_relativa) actualiza en lugar de insertar.
alter table repositorio_documental
  add constraint if not exists uq_agente_ruta
  unique (agente_id, ruta_relativa);

-- documento_uid debe ser único en toda la tabla.
alter table repositorio_documental
  add constraint if not exists uq_documento_uid
  unique (documento_uid);

-- ── Índices ──────────────────────────────────────────────────

-- Filtrado por agente (consulta más frecuente)
create index if not exists idx_repdoc_agente
  on repositorio_documental (agente_id);

-- Búsqueda por tipo de documento (para RRHH, Operaciones, etc.)
create index if not exists idx_repdoc_tipo
  on repositorio_documental (tipo_documento)
  where tipo_documento is not null;

-- Búsqueda por empresa (multi-empresa futuro)
create index if not exists idx_repdoc_empresa
  on repositorio_documental (empresa);

-- Filtrado de documentos disponibles (el más común en consultas operativas)
create index if not exists idx_repdoc_disponible
  on repositorio_documental (disponible);

-- Búsqueda por extensión
create index if not exists idx_repdoc_extension
  on repositorio_documental (extension);

-- Ordenamiento y filtrado por fecha de modificación
create index if not exists idx_repdoc_modificacion
  on repositorio_documental (fecha_modificacion_archivo desc);

-- Búsqueda por categoría (para clasificación futura)
create index if not exists idx_repdoc_categoria
  on repositorio_documental (categoria)
  where categoria is not null;

-- ── Row Level Security ───────────────────────────────────────

alter table repositorio_documental enable row level security;

-- Solo el service_role (usado por el Agente MERCOSUR y las API routes)
-- puede operar esta tabla. La anon key no tiene acceso.
create policy if not exists "service_role full access"
  on repositorio_documental for all
  to service_role
  using (true)
  with check (true);

-- Administradores de la aplicación pueden leer (para futuro panel de gestión documental)
-- Requiere que exista la tabla usuarios con campo rol y auth_user_id.
-- Descomentar cuando se implemente el panel:
--
-- create policy "admin read repositorio_documental"
--   on repositorio_documental for select
--   to authenticated
--   using (
--     exists (
--       select 1 from usuarios
--       where auth_user_id = auth.uid()
--         and rol = 'admin'
--     )
--   );

-- ── Trigger actualizado_at ───────────────────────────────────

create or replace function set_actualizado_at()
returns trigger language plpgsql as $$
begin
  new.actualizado_at := now();
  return new;
end;
$$;

create trigger trg_repdoc_actualizado_at
  before update on repositorio_documental
  for each row execute function set_actualizado_at();
