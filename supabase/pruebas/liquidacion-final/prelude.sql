-- Esqueleto mínimo de producción para probar 20261110120000_liquidacion_final_borrador.
-- Tablas con las columnas que usa la migración (definiciones copiadas de sus
-- migraciones: liq1a, liq3, 20261008100000, 20261009130000, 20261017120000) y las
-- funciones de permiso tal como están hoy (20260920140000).
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant usage on schema public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.usuarios (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, estado text default 'activo',
  rol text, puesto_organizacional text, es_prueba boolean default false, excluir_pago_banco boolean not null default false,
  nombre text, apellido text, cuil text, legajo text, legajo_visual text);
grant select, update on public.usuarios to authenticated;

CREATE OR REPLACE FUNCTION public.es_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia' or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )) $function$;
create or replace function public.puede_liquidar_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion')
$fn$;

create table public.legajo_datos_personales (
  empleado_id uuid primary key references public.usuarios(id) on delete restrict,
  fecha_ingreso date);

create table public.liquidacion_periodo (
  id uuid primary key default gen_random_uuid(), mes text not null, estado text not null default 'borrador'
  check (estado in ('borrador','revision','consolidada','exportada','liquidada','anulado')));

create table public.liquidacion_enviado_visual (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.liquidacion_periodo(id) on delete cascade,
  cuil text, cod_interno text, codigo text not null, cantidad numeric, importe numeric,
  enviado_at timestamptz not null default now(),
  unique (periodo_id, cuil, codigo));

create table public.liquidacion_pago_lote (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.liquidacion_periodo(id) on delete restrict,
  tipo text not null check (tipo in ('sueldos', 'extras')), archivo text, hash text not null,
  total numeric not null, filas int not null, registrado_por uuid, registrado_at timestamptz not null default now(),
  anulado_at timestamptz, anulado_por uuid, motivo_anulacion text, unique (periodo_id, tipo, hash));
create table public.liquidacion_pago_registrado (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.liquidacion_pago_lote(id) on delete restrict,
  periodo_id uuid not null references public.liquidacion_periodo(id) on delete restrict,
  tipo text not null check (tipo in ('sueldos', 'extras')),
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  cuenta text, importe numeric not null check (importe > 0));

create table public.arca_relaciones_laborales (
  id bigserial primary key, consulta_fecha date not null, cuil text not null check (cuil ~ '^\d{11}$'),
  apellido_nombre text not null, modalidad text, fecha_inicio date not null, fecha_fin date, situacion_baja text,
  obra_social text, archivo text, cargado_por uuid references public.usuarios(id) on delete set null,
  cargado_at timestamptz not null default now(), unique (consulta_fecha, cuil, fecha_inicio));

-- auth = 1000..., usuarios.id = 2000...
insert into public.usuarios (id, auth_user_id, rol, puesto_organizacional, nombre, apellido, cuil, legajo_visual) values
  ('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000001001','admin','gerencia','Gere','Ncia',null,null),
  ('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000001002','admin','administracion','Admi','Nistra',null,null),
  ('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000001003','supervisor','jefe_supervisores','Jefe','Sup',null,null),
  ('00000000-0000-0000-0000-000000002010','00000000-0000-0000-0000-000000001010','guardia','vigilador','WALTER DARIO','FULLA','20285365814','FULLA w'),
  ('00000000-0000-0000-0000-000000002011','00000000-0000-0000-0000-000000001011','guardia','vigilador','EDGAR IVAN','PANIAGUA','20441767871','010 Bis'),
  ('00000000-0000-0000-0000-000000002012','00000000-0000-0000-0000-000000001012','guardia','vigilador','SIN','CUIL',null,null),
  ('00000000-0000-0000-0000-000000002013','00000000-0000-0000-0000-000000001013','guardia','vigilador','DE','PRUEBA','20000000019',null);
update public.usuarios set es_prueba = true where id = '00000000-0000-0000-0000-000000002013';
insert into public.legajo_datos_personales values
  ('00000000-0000-0000-0000-000000002010','2023-03-01'),
  ('00000000-0000-0000-0000-000000002011','2026-08-02');
