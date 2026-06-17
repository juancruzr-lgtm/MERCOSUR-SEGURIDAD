create table if not exists supervisor_intervenciones (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid references turnos(id) on delete cascade,
  registro_asistencia_id uuid references registros_asistencia(id),
  supervisor_id uuid references usuarios(id),
  tipo_alerta text not null,
  accion text not null,
  comentario text,
  motivo text,
  guardia_anterior_id uuid references usuarios(id),
  guardia_nuevo_id uuid references usuarios(id),
  estado_anterior text,
  estado_nuevo text,
  created_at timestamptz default now()
);

alter table supervisor_intervenciones add column if not exists registro_asistencia_id uuid references registros_asistencia(id);
alter table supervisor_intervenciones add column if not exists supervisor_id uuid references usuarios(id);
alter table supervisor_intervenciones add column if not exists tipo_alerta text;
alter table supervisor_intervenciones add column if not exists accion text;
alter table supervisor_intervenciones add column if not exists comentario text;
alter table supervisor_intervenciones add column if not exists motivo text;
alter table supervisor_intervenciones add column if not exists guardia_anterior_id uuid references usuarios(id);
alter table supervisor_intervenciones add column if not exists guardia_nuevo_id uuid references usuarios(id);
alter table supervisor_intervenciones add column if not exists estado_anterior text;
alter table supervisor_intervenciones add column if not exists estado_nuevo text;
alter table supervisor_intervenciones add column if not exists created_at timestamptz default now();

alter table supervisor_intervenciones enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'supervisor_intervenciones'
      and policyname = 'Admin acceso total supervisor intervenciones'
  ) then
    create policy "Admin acceso total supervisor intervenciones"
      on supervisor_intervenciones
      for all
      using (true);
  end if;
end $$;
