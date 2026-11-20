-- Esqueleto mínimo de producción para probar las alertas de documentación.
-- Las funciones de permisos son copia de pg_get_functiondef en producción
-- (04/11/2026); tiene_delegacion_gerencia se simula (sin delegaciones).
-- Las tablas tienen sólo las columnas que usan estas funciones.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

create table public.usuarios (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, estado text default 'activo',
  rol text, puesto_organizacional text, es_prueba boolean default false, acceso_bloqueado boolean default false,
  nombre text, apellido text, legajo text);
grant select on public.usuarios to authenticated;

create table public.repositorio_documental (id uuid primary key default gen_random_uuid());

create table public.documentacion_tipos (
  codigo text primary key, nombre text not null, orden integer not null default 0,
  requisito text not null check (requisito in ('obligatorio','opcional','si_corresponde')),
  campo_vencimiento text not null default 'no', vigencia_meses integer,
  sensibilidad text not null check (sensibilidad in ('comun','sensible','reservado_gerencia')),
  activo boolean not null default true);
grant select on public.documentacion_tipos to authenticated;

create table public.documentacion_documentos (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.usuarios(id),
  tipo text not null references public.documentacion_tipos(codigo),
  sensibilidad text not null, detalle text, fecha_emision date, vence_el date,
  estado text not null default 'subiendo' check (estado in ('subiendo','pendiente_revision','pendiente_aceptacion',
    'aprobado','aceptado','rechazado','observado','reemplazado','anulado')),
  creado_at timestamptz not null default now(),
  reemplazado_por uuid references public.documentacion_documentos(id), reemplazado_at timestamptz);

create table public.documentacion_situaciones (
  id bigint generated always as identity primary key,
  empleado_id uuid not null references public.usuarios(id),
  tipo text not null references public.documentacion_tipos(codigo),
  situacion text not null check (situacion in ('no_corresponde','solicitado','sin_efecto')),
  at timestamptz not null default now());

create table public.habilitacion_tramites (
  id uuid primary key default gen_random_uuid(), empleado_id uuid not null references public.usuarios(id),
  tipo text not null default 'renovacion', estado text not null default 'en_curso',
  abierto_at timestamptz not null default now());

create table public.habilitacion_credenciales (
  id uuid primary key default gen_random_uuid(), empleado_id uuid not null references public.usuarios(id),
  numero text, fecha_emision date, vence_el date, documento_id uuid references public.documentacion_documentos(id),
  tramite_id uuid references public.habilitacion_tramites(id), verificada boolean not null default true,
  observacion text, registrada_por uuid, registrada_at timestamptz not null default now(),
  anulada_at timestamptz, anulada_por uuid, motivo_anulacion text);

create function public.tiene_delegacion_gerencia(p uuid) returns boolean language sql stable as $$ select false $$;

-- ── Copias de producción ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rondas_usuario_actual_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $function$;
CREATE OR REPLACE FUNCTION public.tiene_delegacion_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and public.tiene_delegacion_gerencia(u.id)) $function$;
CREATE OR REPLACE FUNCTION public.acceso_habilitado_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select not exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.acceso_bloqueado) $function$;
CREATE OR REPLACE FUNCTION public.legajo_puede_gestionar() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select auth.uid() is not null
     and (exists (select 1 from public.usuarios u
                  where u.auth_user_id = auth.uid() and u.estado = 'activo'
                    and u.puesto_organizacional in ('administracion','gerencia'))
          or coalesce(public.tiene_delegacion_gerencia_actual(), false)) $function$;
CREATE OR REPLACE FUNCTION public.documentacion_es_gerencia() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select auth.uid() is not null
     and (exists (select 1 from public.usuarios u
                  where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional = 'gerencia')
          or coalesce(public.tiene_delegacion_gerencia_actual(), false)) $function$;
CREATE OR REPLACE FUNCTION public.documentacion_puede_gestionar() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select public.legajo_puede_gestionar() $function$;
CREATE OR REPLACE FUNCTION public.documentacion_puede_ver(p_empleado_id uuid, p_sensibilidad text, p_estado text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select auth.uid() is not null and (
    public.documentacion_es_gerencia()
    or (p_sensibilidad <> 'reservado_gerencia' and (
          public.documentacion_puede_gestionar()
          or (p_empleado_id = public.rondas_usuario_actual_id()
              and p_estado not in ('subiendo','anulado'))))
  ) $function$;
CREATE OR REPLACE FUNCTION public.documentacion_usuario_actual() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $function$;
create or replace function public.documentacion_inmutable() returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  raise exception 'La documentacion del legajo no se borra ni se modifica (% en %)', tg_op, tg_table_name using errcode = '42501';
end; $fn$;
