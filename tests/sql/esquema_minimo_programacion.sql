-- Esquema mínimo para correr programacion_conflictos.sql en un Postgres local
-- (sin Supabase). Solo las tablas y columnas que tocan las funciones probadas.
-- NO se aplica en ningún ambiente: es un andamio de prueba.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create table public.usuarios (id uuid primary key default gen_random_uuid(), auth_user_id uuid, nombre text, apellido text,
  rol text, estado text default 'activo', puesto_organizacional text);
create table public.zonas_operativas (id uuid primary key default gen_random_uuid(), nombre text);
create table public.objetivos (id uuid primary key default gen_random_uuid(), nombre text, estado text default 'activo',
  zona_id uuid, es_prueba boolean default false);
create table public.puestos (id uuid primary key default gen_random_uuid(), objetivo_id uuid, nombre text, activo boolean default true);
create table public.supervisor_zonas (id uuid primary key default gen_random_uuid(), supervisor_id uuid, zona_id uuid);
create table public.turnos (id uuid primary key default gen_random_uuid(), guardia_id uuid, objetivo_id uuid references public.objetivos(id),
  puesto_id uuid, fecha date, hora_inicio time, hora_fin time, estado text default 'programado', tipo_evento text default 'normal',
  guardia_original_id uuid, editado_por uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace function public.update_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
create trigger turnos_updated_at before update on public.turnos for each row execute function public.update_updated_at();
create table public.turnos_auditoria (id uuid primary key default gen_random_uuid(), turno_id uuid not null, modificado_por uuid not null,
  campo text not null, valor_anterior text, valor_nuevo text, comentario text, created_at timestamptz default now());
create table public.registros_asistencia (id uuid primary key default gen_random_uuid(), turno_id uuid, guardia_id uuid,
  tipo_registro text, hora_entrada_real time, hora_salida_real time, hora_entrada_final time, hora_salida_final time,
  horas_trabajadas numeric, horas_liquidables numeric, origen_cobertura text, estado_revision text default 'pendiente_supervisor',
  registro_anulado_at timestamptz, cobertura_anulada_at timestamptz, created_at timestamptz default now());
create table public.revisiones_planilla (id uuid primary key default gen_random_uuid(), turno_id uuid not null);
create table public.ronda_ejecuciones (id uuid primary key default gen_random_uuid(), turno_id uuid);
create table public.evidencias (id uuid primary key default gen_random_uuid(), turno_id uuid);
create table public.liquidacion_periodo (id uuid primary key default gen_random_uuid(), mes text, estado text);
create table public.notificaciones_enviadas (id uuid primary key default gen_random_uuid(), usuario_id uuid, turno_id uuid, tipo text,
  created_at timestamptz default now());
create table public.escalamiento_whatsapp_envios (id uuid primary key default gen_random_uuid(), turno_id uuid, nivel text,
  created_at timestamptz default now());
create table public.ronda_alertas (id uuid primary key default gen_random_uuid(), turno_id uuid, estado text default 'pendiente');
create table public.app_config (key text primary key, value text);
create table public.rondas_base (id uuid primary key default gen_random_uuid(), puesto_id uuid, hora_inicio time,
  intervalo_minutos int, activo boolean default true, created_at timestamptz default '2020-01-01');
create table public.ronda_puntos (id uuid primary key default gen_random_uuid(), ronda_base_id uuid, activo boolean default true);
create table public.ronda_horarios_sin_exigencia (id uuid primary key default gen_random_uuid(), ronda_base_id uuid,
  dia_semana int, desde time, hasta time, activo boolean default true);

-- Copias exactas de producción (02/11/2026).
create or replace function public.alcance_operativo_de(p_usuario_id uuid) returns text language sql stable security definer
set search_path to 'public', 'pg_catalog' as $$
  select case
    when u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia') then 'todas'
    when u.puesto_organizacional = 'supervisor' then 'zonas_asignadas'
    when u.puesto_organizacional = 'vigilador' then 'propio'
    when lower(u.rol) = 'admin' then 'todas'
    when lower(u.rol) = 'supervisor' then 'zonas_asignadas'
    else 'propio' end
  from public.usuarios u where u.id = p_usuario_id
$$;
create or replace function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) returns boolean language sql stable
security definer set search_path to 'public', 'pg_catalog' as $$
  select case public.alcance_operativo_de(p_usuario_id)
    when 'todas' then true
    when 'zonas_asignadas' then exists (select 1 from public.objetivos o join public.supervisor_zonas sz on sz.zona_id = o.zona_id
      where o.id = p_objetivo_id and sz.supervisor_id = p_usuario_id)
    else false end
$$;
create or replace function public.alcanza_objetivo_actual(p_objetivo_id uuid) returns boolean language sql stable security definer
set search_path to 'public', 'pg_catalog' as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
    and public.alcanza_objetivo(u.id, p_objetivo_id))
$$;
