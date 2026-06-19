create table if not exists solicitudes_admin (
  id uuid primary key default gen_random_uuid(),
  solicitante_id uuid not null references usuarios(id),
  tipo text not null check (tipo in ('crear_objetivo', 'baja_objetivo', 'crear_vigilador', 'baja_vigilador')),
  entidad text not null,
  entidad_id uuid,
  datos_json jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  aprobado_por uuid references usuarios(id),
  fecha_aprobacion timestamptz,
  comentario_admin text,
  created_at timestamptz default now()
);

create index if not exists idx_solicitudes_admin_estado
  on solicitudes_admin (estado, created_at desc);
create index if not exists idx_solicitudes_admin_solicitante
  on solicitudes_admin (solicitante_id, created_at desc);
create index if not exists idx_solicitudes_admin_entidad
  on solicitudes_admin (entidad, entidad_id);

alter table solicitudes_admin enable row level security;

create policy "Admin acceso total solicitudes admin" on solicitudes_admin for all using (true);
