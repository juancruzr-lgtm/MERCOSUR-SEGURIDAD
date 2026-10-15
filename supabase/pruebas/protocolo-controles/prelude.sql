-- Se carga DESPUÉS de ../protocolos/prelude.sql. Suma lo mínimo del motor de
-- checklist (20260624_supervisiones_checklist.sql) y de rondas nativas
-- (20260725_rondas_nativas_base.sql) que la migración lee o escribe.
create table public.checklist_plantillas (
  id uuid primary key default gen_random_uuid(), nombre text not null, descripcion text,
  activo boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references public.checklist_plantillas(id) on delete cascade,
  texto text not null, orden integer not null default 0, obligatorio boolean not null default true,
  criticidad text not null default 'normal' check (criticidad in ('normal', 'alta')),
  foto_obligatoria boolean not null default false, activo boolean not null default true,
  created_at timestamptz not null default now());
alter table public.objetivos add column checklist_plantilla_id uuid references public.checklist_plantillas(id);
-- Como en producción: el supervisor lee plantillas e ítems (para SupervisorMobile).
alter table public.checklist_plantillas enable row level security;
alter table public.checklist_items enable row level security;
grant select on public.checklist_plantillas, public.checklist_items to authenticated;
create policy lee_plantillas on public.checklist_plantillas for select to authenticated using (true);
create policy lee_items on public.checklist_items for select to authenticated using (true);

create table public.rondas_base (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  nombre text not null, descripcion text, intervalo_minutos integer not null, activo boolean not null default true,
  updated_at timestamptz not null default now());
create table public.ronda_puntos (
  id uuid primary key default gen_random_uuid(), ronda_base_id uuid not null references public.rondas_base(id),
  nombre text not null, descripcion text, orden integer not null, activo boolean not null default true,
  updated_at timestamptz not null default now());

-- Plantilla genérica «supervision simple» (como la de producción) asignada a
-- Randstad y La Casona.
insert into public.checklist_plantillas (id, nombre) values
  ('00000000-0000-0000-0000-0000000000c1', 'supervision simple');
insert into public.checklist_items (id, plantilla_id, texto, orden) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Presentación personal del vigilador', 1),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Libro de novedades al día', 2),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'Foto cargada', 3);
update public.objetivos set checklist_plantilla_id = '00000000-0000-0000-0000-0000000000c1'
 where id in ('ac273ff2-71f6-4de2-ae4e-c0d518795dad', '335179ef-af0e-41e7-9a38-66a2da661f48');

-- Una ronda de Randstad con un punto, y una de La Casona.
insert into public.rondas_base (id, objetivo_id, nombre, intervalo_minutos) values
  ('00000000-0000-0000-0000-0000000000e1', 'ac273ff2-71f6-4de2-ae4e-c0d518795dad', 'Recorrida de pisos', 120),
  ('00000000-0000-0000-0000-0000000000e2', '335179ef-af0e-41e7-9a38-66a2da661f48', 'Perímetro', 60);
insert into public.ronda_puntos (id, ronda_base_id, nombre, orden) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'Puerta del piso 7', 1),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', 'Portón trasero', 1);
