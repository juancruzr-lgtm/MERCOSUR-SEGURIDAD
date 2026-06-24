-- Modulo Supervisiones Fase 1.
-- No activa RLS. El bucket Supabase Storage "supervision-fotos" debe crearse manualmente.

create extension if not exists pgcrypto;

create table if not exists checklist_plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references checklist_plantillas(id) on delete cascade,
  texto text not null,
  orden integer not null default 0,
  obligatorio boolean not null default true,
  criticidad text not null default 'normal',
  foto_obligatoria boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint checklist_items_criticidad_check check (criticidad in ('normal', 'alta'))
);

alter table objetivos
  add column if not exists checklist_plantilla_id uuid references checklist_plantillas(id);

alter table objetivos
  add column if not exists frecuencia_supervision_horas integer not null default 24;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'objetivos_frecuencia_supervision_horas_check'
  ) then
    alter table objetivos
      add constraint objetivos_frecuencia_supervision_horas_check
      check (frecuencia_supervision_horas > 0);
  end if;
end $$;

create table if not exists supervisiones (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null references objetivos(id),
  supervisor_id uuid not null references usuarios(id),
  plantilla_id uuid references checklist_plantillas(id),
  lat numeric not null,
  lng numeric not null,
  precision_gps numeric not null,
  estado text not null default 'ok',
  observaciones text,
  created_at timestamptz not null default now(),
  constraint supervisiones_estado_check check (estado in ('ok', 'con_observacion', 'critico'))
);

create table if not exists supervision_respuestas (
  id uuid primary key default gen_random_uuid(),
  supervision_id uuid not null references supervisiones(id) on delete cascade,
  item_id uuid not null references checklist_items(id),
  resultado text not null,
  observacion text,
  created_at timestamptz not null default now(),
  constraint supervision_respuestas_resultado_check check (resultado in ('correcto', 'observado', 'no_aplica')),
  constraint supervision_respuestas_unicas unique (supervision_id, item_id)
);

create table if not exists supervision_fotos (
  id uuid primary key default gen_random_uuid(),
  supervision_id uuid not null references supervisiones(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_checklist_items_plantilla
  on checklist_items (plantilla_id, activo, orden);

create index if not exists idx_objetivos_checklist_plantilla
  on objetivos (checklist_plantilla_id);

create index if not exists idx_supervisiones_objetivo_created
  on supervisiones (objetivo_id, created_at desc);

create index if not exists idx_supervisiones_supervisor_created
  on supervisiones (supervisor_id, created_at desc);

create index if not exists idx_supervisiones_estado_created
  on supervisiones (estado, created_at desc);

create index if not exists idx_supervision_respuestas_supervision
  on supervision_respuestas (supervision_id);

create index if not exists idx_supervision_fotos_supervision
  on supervision_fotos (supervision_id);

create or replace function touch_checklist_plantillas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_checklist_plantillas_updated_at on checklist_plantillas;

create trigger trg_touch_checklist_plantillas_updated_at
before update on checklist_plantillas
for each row
execute function touch_checklist_plantillas_updated_at();

create or replace function validar_supervision_plantilla()
returns trigger
language plpgsql
as $$
declare
  objetivo_plantilla uuid;
begin
  select checklist_plantilla_id
    into objetivo_plantilla
  from objetivos
  where id = new.objetivo_id;

  if objetivo_plantilla is not null then
    if new.plantilla_id is null then
      raise exception 'La supervision requiere plantilla para este objetivo';
    end if;

    if new.plantilla_id <> objetivo_plantilla then
      raise exception 'La plantilla de la supervision no coincide con la plantilla del objetivo';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_supervision_plantilla on supervisiones;

create trigger trg_validar_supervision_plantilla
before insert or update on supervisiones
for each row
execute function validar_supervision_plantilla();
