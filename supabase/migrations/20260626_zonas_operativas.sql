-- Tema 2 - Zonas operativas.
-- No activa RLS (instruccion explicita: gestionar permisos en una fase posterior).

create table if not exists zonas_operativas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  descripcion text,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  created_at timestamptz not null default now()
);

create table if not exists supervisor_zonas (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references usuarios(id) on delete cascade,
  zona_id uuid not null references zonas_operativas(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint supervisor_zonas_unicas unique (supervisor_id, zona_id)
);

alter table objetivos
  add column if not exists zona_id uuid references zonas_operativas(id);

create index if not exists idx_supervisor_zonas_supervisor
  on supervisor_zonas (supervisor_id);

create index if not exists idx_supervisor_zonas_zona
  on supervisor_zonas (zona_id);

create index if not exists idx_objetivos_zona
  on objetivos (zona_id);
