create table if not exists supervisores_guardia (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid references usuarios(id),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  zona text not null default 'Rosario / General',
  rol_operativo text not null default 'supervisor',
  estado text not null default 'activo',
  observacion text,
  creado_por uuid references usuarios(id),
  created_at timestamptz default now()
);

alter table supervisores_guardia add column if not exists supervisor_id uuid references usuarios(id);
alter table supervisores_guardia add column if not exists fecha date;
alter table supervisores_guardia add column if not exists hora_inicio time;
alter table supervisores_guardia add column if not exists hora_fin time;
alter table supervisores_guardia add column if not exists zona text default 'Rosario / General';
alter table supervisores_guardia add column if not exists rol_operativo text default 'supervisor';
alter table supervisores_guardia add column if not exists estado text default 'activo';
alter table supervisores_guardia add column if not exists observacion text;
alter table supervisores_guardia add column if not exists creado_por uuid references usuarios(id);
alter table supervisores_guardia add column if not exists created_at timestamptz default now();

alter table supervisor_intervenciones add column if not exists supervisor_asignado_id uuid references usuarios(id);
alter table supervisor_intervenciones add column if not exists supervisor_intervino_id uuid references usuarios(id);
alter table supervisor_intervenciones add column if not exists supervisor_guardia_id uuid references supervisores_guardia(id);
alter table supervisor_intervenciones add column if not exists jefe_operativo text;
alter table supervisor_intervenciones add column if not exists director_tecnico text;
alter table supervisor_intervenciones add column if not exists zona text;

create index if not exists idx_supervisores_guardia_fecha_horario
  on supervisores_guardia (fecha, hora_inicio, hora_fin);
create index if not exists idx_supervisores_guardia_supervisor
  on supervisores_guardia (supervisor_id);
create index if not exists idx_supervisores_guardia_estado
  on supervisores_guardia (estado);
create index if not exists idx_supervisor_intervenciones_supervisor_guardia
  on supervisor_intervenciones (supervisor_guardia_id);

alter table supervisores_guardia enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'supervisores_guardia'
      and policyname = 'Admin acceso total supervisores guardia'
  ) then
    create policy "Admin acceso total supervisores guardia"
      on supervisores_guardia
      for all
      using (true);
  end if;
end $$;
