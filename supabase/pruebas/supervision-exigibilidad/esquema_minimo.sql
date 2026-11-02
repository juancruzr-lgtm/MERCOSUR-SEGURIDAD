-- Esquema mínimo para compilar y probar 20261113120000 en un PostgreSQL 16
-- LOCAL vacío (NO en producción). Imita sólo lo que la migración toca.
--   createdb exig && psql -d exig -f esquema_minimo.sql \
--     -f ../../migrations/20261113120000_supervision_exigibilidad_servicio.sql \
--     -f pruebas.sql

create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('prueba.uid', true), '')::uuid
$$;

create table public.usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid, nombre text, apellido text, rol text, estado text default 'activo',
  puesto_organizacional text, es_prueba boolean default false
);
create table public.zonas_operativas (id uuid primary key default gen_random_uuid(), nombre text);
create table public.objetivos (
  id uuid primary key default gen_random_uuid(),
  nombre text, estado text not null default 'activo', es_prueba boolean not null default false,
  frecuencia_supervision_horas integer not null default 24, zona_id uuid
);
create table public.objetivos_auditoria (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null references public.objetivos(id) on delete cascade,
  campo text not null, valor_anterior text, valor_nuevo text,
  origen text not null, firma text, modificado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);
create table public.supervisiones (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null, supervisor_id uuid, estado text not null, created_at timestamptz not null
);
create table public.turnos (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid, fecha date, estado text
);

create or replace function public.rondas_usuario_actual_id() returns uuid language sql stable as $$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1
$$;
create or replace function public.acceso_habilitado_actual() returns boolean language sql stable as $$ select true $$;
create or replace function public.tiene_delegacion_gerencia_actual() returns boolean language sql stable as $$ select false $$;

-- Stub de E1: un único responsable fijo por zona, para poder contar.
create or replace function public.responsables_supervision_en(p_zona_id uuid, p_instante timestamptz)
returns table (supervisor_id uuid, origen text) language sql stable as $$
  select '00000000-0000-0000-0000-0000000000aa'::uuid, 'calendario'::text
$$;

-- Definición de producción (02/11/2026) para comparar antes/después.
create or replace function public.evaluacion_vencimientos_supervision(p_desde date, p_hasta date)
returns table (objetivo_id uuid, supervisor_id uuid, vencio_at timestamptz, regularizado_at timestamptz, horas_vencido numeric)
language sql stable security definer set search_path = public, pg_catalog as $$
  with params as (
    select (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires') as t0,
           least(now(), (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t1
  ),
  sup as (
    select s.objetivo_id, s.created_at,
           lead(s.created_at) over (partition by s.objetivo_id order by s.created_at) as siguiente
      from public.supervisiones s where s.estado <> 'incompleta'
  ),
  venc as (
    select o.id as objetivo_id, o.zona_id,
           s.created_at + make_interval(hours => o.frecuencia_supervision_horas) as vencio_at,
           s.siguiente as regularizado_at
      from sup s join public.objetivos o on o.id = s.objetivo_id
     where o.estado = 'activo' and coalesce(o.es_prueba, false) = false
       and o.frecuencia_supervision_horas is not null
       and coalesce(s.siguiente, now()) > s.created_at + make_interval(hours => o.frecuencia_supervision_horas)
  )
  select v.objetivo_id, r.supervisor_id, v.vencio_at, v.regularizado_at,
         round((extract(epoch from least(coalesce(v.regularizado_at, p.t1), p.t1)
                                  - greatest(v.vencio_at, p.t0)) / 3600.0)::numeric, 1)
    from venc v cross join params p
    cross join lateral public.responsables_supervision_en(v.zona_id, greatest(v.vencio_at, p.t0)) r
   where v.vencio_at < p.t1 and coalesce(v.regularizado_at, now()) > p.t0
     and exists (select 1 from public.turnos t where t.objetivo_id = v.objetivo_id
                    and t.fecha between (greatest(v.vencio_at, p.t0) at time zone 'America/Argentina/Buenos_Aires')::date
                                    and (least(coalesce(v.regularizado_at, p.t1), p.t1) at time zone 'America/Argentina/Buenos_Aires')::date)
$$;

-- Copia con otro nombre: la migración reemplaza la original y la prueba compara.
create or replace function public.evaluacion_vencimientos_supervision_vieja(p_desde date, p_hasta date)
returns table (objetivo_id uuid, supervisor_id uuid, vencio_at timestamptz, regularizado_at timestamptz, horas_vencido numeric)
language sql stable security definer set search_path = public, pg_catalog as $$
  with params as (
    select (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires') as t0,
           least(now(), (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t1
  ),
  sup as (
    select s.objetivo_id, s.created_at,
           lead(s.created_at) over (partition by s.objetivo_id order by s.created_at) as siguiente
      from public.supervisiones s where s.estado <> 'incompleta'
  ),
  venc as (
    select o.id as objetivo_id, o.zona_id,
           s.created_at + make_interval(hours => o.frecuencia_supervision_horas) as vencio_at,
           s.siguiente as regularizado_at
      from sup s join public.objetivos o on o.id = s.objetivo_id
     where o.estado = 'activo' and coalesce(o.es_prueba, false) = false
       and o.frecuencia_supervision_horas is not null
       and coalesce(s.siguiente, now()) > s.created_at + make_interval(hours => o.frecuencia_supervision_horas)
  )
  select v.objetivo_id, r.supervisor_id, v.vencio_at, v.regularizado_at,
         round((extract(epoch from least(coalesce(v.regularizado_at, p.t1), p.t1)
                                  - greatest(v.vencio_at, p.t0)) / 3600.0)::numeric, 1)
    from venc v cross join params p
    cross join lateral public.responsables_supervision_en(v.zona_id, greatest(v.vencio_at, p.t0)) r
   where v.vencio_at < p.t1 and coalesce(v.regularizado_at, now()) > p.t0
     and exists (select 1 from public.turnos t where t.objetivo_id = v.objetivo_id
                    and t.fecha between (greatest(v.vencio_at, p.t0) at time zone 'America/Argentina/Buenos_Aires')::date
                                    and (least(coalesce(v.regularizado_at, p.t1), p.t1) at time zone 'America/Argentina/Buenos_Aires')::date)
$$;
