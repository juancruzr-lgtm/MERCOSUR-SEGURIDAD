-- ============================================================
-- MERCOSUR SEGURIDAD — Schema de base de datos
-- Ejecutar este script en Supabase SQL Editor
-- ============================================================

-- 1. USUARIOS / GUARDIAS
create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  apellido text not null,
  dni text,
  email text,
  telefono text,
  legajo text unique not null,
  rol text not null check (rol in ('admin','supervisor','guardia','vigilador')),
  estado text not null default 'activo' check (estado in ('activo','inactivo')),
  foto_url text,
  auth_user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table usuarios add column if not exists email text;
alter table usuarios add column if not exists foto_url text;
alter table usuarios add column if not exists dni text;
alter table usuarios add column if not exists auth_user_id uuid references auth.users(id);

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'usuarios'
      and constraint_name = 'usuarios_rol_check'
  ) then
    alter table usuarios drop constraint usuarios_rol_check;
  end if;

  alter table usuarios
    add constraint usuarios_rol_check
    check (rol in ('admin','supervisor','guardia','vigilador'));
exception
  when duplicate_object then null;
end $$;

-- 2. OBJETIVOS
create table if not exists objetivos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cliente text not null,
  direccion text,
  lat numeric,
  lng numeric,
  radio_metros integer default 300,
  estado text not null default 'activo' check (estado in ('activo','inactivo')),
  created_at timestamptz default now()
);

-- 3. CAMARAS
create table if not exists camaras (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid references objetivos(id) on delete cascade,
  nombre text not null,
  url_stream text,
  url_web text,
  sector text,
  estado text default 'activo',
  created_at timestamptz default now()
);

-- 4. TURNOS
create table if not exists turnos (
  id uuid primary key default gen_random_uuid(),
  guardia_id uuid references usuarios(id),
  objetivo_id uuid references objetivos(id) on delete cascade,
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  estado text not null default 'programado' check (estado in ('programado','cubierto','descubierto')),
  created_at timestamptz default now()
);

-- 5. REGISTROS DE ASISTENCIA
create table if not exists registros_asistencia (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid references turnos(id),
  guardia_id uuid references usuarios(id),
  hora_entrada_real time,
  hora_salida_real time,
  lat_entrada numeric,
  lng_entrada numeric,
  lat_salida numeric,
  lng_salida numeric,
  foto_entrada_url text,
  horas_trabajadas numeric,
  alerta_entrada text check (alerta_entrada in ('tarde','anticipada',null)),
  alerta_salida text check (alerta_salida in ('anticipada','posterior',null)),
  uniforme_estado text check (uniforme_estado in ('ok','advertencia','alerta',null)),
  uniforme_puntaje integer,
  uniforme_detalle jsonb,
  observacion text,
  created_at timestamptz default now()
);

alter table registros_asistencia add column if not exists latitud_ingreso numeric;
alter table registros_asistencia add column if not exists longitud_ingreso numeric;
alter table registros_asistencia add column if not exists precision_ingreso numeric;
alter table registros_asistencia add column if not exists latitud_egreso numeric;
alter table registros_asistencia add column if not exists longitud_egreso numeric;
alter table registros_asistencia add column if not exists precision_egreso numeric;
alter table registros_asistencia add column if not exists distancia_ingreso_metros numeric;
alter table registros_asistencia add column if not exists gps_ingreso_estado text;
alter table registros_asistencia add column if not exists distancia_egreso_metros numeric;
alter table registros_asistencia add column if not exists gps_egreso_estado text;

-- 6. NOVEDADES
create table if not exists novedades (
  id uuid primary key default gen_random_uuid(),
  guardia_id uuid references usuarios(id),
  objetivo_id uuid references objetivos(id),
  tipo text not null,
  descripcion text not null,
  foto_url text,
  prioridad text not null default 'normal' check (prioridad in ('normal','importante','urgente')),
  estado text not null default 'pendiente' check (estado in ('pendiente','revisada','resuelta')),
  created_at timestamptz default now()
);

-- 7. ALERTAS
create table if not exists alertas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  mensaje text not null,
  objetivo_id uuid references objetivos(id),
  guardia_id uuid references usuarios(id),
  camara_id uuid references camaras(id),
  leida boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table usuarios enable row level security;
alter table objetivos enable row level security;
alter table turnos enable row level security;
alter table registros_asistencia enable row level security;
alter table novedades enable row level security;
alter table alertas enable row level security;
alter table camaras enable row level security;

-- Políticas: admin ve todo, guardia ve solo lo suyo
create policy "Admin acceso total usuarios" on usuarios for all using (true);
create policy "Admin acceso total objetivos" on objetivos for all using (true);
create policy "Admin acceso total turnos" on turnos for all using (true);
create policy "Admin acceso total registros" on registros_asistencia for all using (true);
create policy "Admin acceso total novedades" on novedades for all using (true);
create policy "Admin acceso total alertas" on alertas for all using (true);
create policy "Admin acceso total camaras" on camaras for all using (true);

-- ============================================================
-- DATOS DE EJEMPLO
-- ============================================================
insert into objetivos (nombre, cliente, direccion, lat, lng) values
  ('Banco Nación Palermo', 'Banco Nación', 'Av. Santa Fe 3200, CABA', -34.5875, -58.4340),
  ('Shopping Unicenter', 'Cencosud', 'Paraná 3745, Martínez', -34.4955, -58.5180),
  ('Laboratorio Bagó', 'Bagó S.A.', 'Bernardo de Irigoyen 248, CABA', -34.6142, -58.3749);
