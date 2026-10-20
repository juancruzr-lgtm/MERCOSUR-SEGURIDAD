-- Esqueleto mínimo de producción para probar 20261110120000 (baja laboral +
-- liquidación final). Columnas copiadas de sus migraciones (liq1a, liq3,
-- 20261008100000, 20261009130000, 20261009140000, 20260716) y funciones de
-- permiso como están hoy (20260920140000, 20261009130000, 20260921140000).
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
  nombre text, apellido text, dni text, cuil text, legajo text, legajo_visual text);

create function public.tiene_delegacion_gerencia(p uuid) returns boolean language sql stable as $$ select false $$;
CREATE OR REPLACE FUNCTION public.es_operador_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')) )) $function$;
CREATE OR REPLACE FUNCTION public.puede_gestionar_personal_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia') or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )) $function$;
CREATE OR REPLACE FUNCTION public.es_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia' or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )) $function$;
CREATE OR REPLACE FUNCTION public.tiene_delegacion_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and public.tiene_delegacion_gerencia(u.id)) $function$;
CREATE OR REPLACE FUNCTION public.puede_acceder_gerencia_actual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_catalog' AS $function$
  select public.es_gerencia_actual() or public.tiene_delegacion_gerencia_actual() $function$;
create or replace function public.puede_liquidar_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion')
$fn$;
create or replace function public.legajo_puede_gestionar()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select auth.uid() is not null
     and (exists (select 1 from public.usuarios u
                  where u.auth_user_id = auth.uid() and u.estado = 'activo'
                    and u.puesto_organizacional in ('administracion','gerencia'))
          or coalesce(public.tiene_delegacion_gerencia_actual(), false))
$fn$;

-- RLS de usuarios como producción (20260908140000): operadores ven todo, cada uno su fila.
alter table public.usuarios enable row level security;
grant select, update on public.usuarios to authenticated;
create policy usuarios_select on public.usuarios for select to authenticated using (public.es_operador_actual() or auth_user_id = auth.uid());
create policy usuarios_update on public.usuarios for update to authenticated using (public.puede_gestionar_personal_actual()) with check (public.puede_gestionar_personal_actual());

create table public.objetivos (id uuid primary key default gen_random_uuid(), nombre text);
create table public.turnos (
  id uuid primary key default gen_random_uuid(), guardia_id uuid references public.usuarios(id), objetivo_id uuid references public.objetivos(id),
  puesto_id uuid, fecha date, hora_inicio time, hora_fin time, estado text default 'programado');
-- Asistencia: el vigilador escribe y lee la suya (patrón de H-B4-01).
create table public.registros_asistencia (id uuid primary key default gen_random_uuid(), turno_id uuid references public.turnos(id), guardia_id uuid, tipo text);
alter table public.registros_asistencia enable row level security;
grant select, insert on public.registros_asistencia to authenticated;
create policy asistencia_propia on public.registros_asistencia for all to authenticated
  using (guardia_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid()))
  with check (guardia_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid()));

create table public.novedades_laborales (
  id uuid primary key default gen_random_uuid(), empleado_id uuid references public.usuarios(id), tipo text,
  fecha_desde date, fecha_hasta date, estado text default 'aprobada');

create table public.legajo_datos_personales (
  empleado_id uuid primary key references public.usuarios(id) on delete restrict,
  fecha_ingreso date);

create table public.documentacion_tipos (
  codigo text primary key, nombre text not null, ayuda text, orden integer not null, requisito text not null, etapa text not null,
  caras text[], multiple boolean not null default false, campo_fecha text not null default 'opcional', etiqueta_fecha text not null default 'Fecha de emisión',
  campo_vencimiento text not null default 'no', vigencia_meses integer, etiqueta_detalle text, sube_vigilador boolean not null,
  sensibilidad text not null, constancia text not null, texto_constancia text, referencia text, activo boolean not null default true,
  constraint documentacion_tipos_constancia check ((constancia = 'ninguna') = (texto_constancia is null)));
create table public.documentacion_documentos (
  id uuid primary key default gen_random_uuid(), empleado_id uuid not null references public.usuarios(id), tipo text not null references public.documentacion_tipos(codigo),
  estado text not null default 'pendiente_revision');

create table public.liquidacion_periodo (
  id uuid primary key default gen_random_uuid(), mes text not null, estado text not null default 'borrador'
  check (estado in ('borrador','revision','consolidada','exportada','liquidada','anulado')));
create table public.liquidacion_enviado_visual (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.liquidacion_periodo(id) on delete cascade,
  cuil text, cod_interno text, codigo text not null, cantidad numeric, importe numeric,
  enviado_at timestamptz not null default now(), unique (periodo_id, cuil, codigo));
create table public.liquidacion_pago_lote (
  id uuid primary key default gen_random_uuid(), periodo_id uuid not null references public.liquidacion_periodo(id) on delete restrict,
  tipo text not null check (tipo in ('sueldos', 'extras')), archivo text, hash text not null, total numeric not null, filas int not null,
  registrado_por uuid, registrado_at timestamptz not null default now(), anulado_at timestamptz, anulado_por uuid, motivo_anulacion text,
  unique (periodo_id, tipo, hash));
create table public.liquidacion_pago_registrado (
  id uuid primary key default gen_random_uuid(), lote_id uuid not null references public.liquidacion_pago_lote(id) on delete restrict,
  periodo_id uuid not null references public.liquidacion_periodo(id) on delete restrict, tipo text not null check (tipo in ('sueldos', 'extras')),
  usuario_id uuid not null references public.usuarios(id) on delete restrict, cuenta text, importe numeric not null check (importe > 0));

-- auth = 1000..., usuarios.id = 2000... Los de prueba NO son Fulla ni Paniagua reales.
insert into public.usuarios (id, auth_user_id, rol, puesto_organizacional, nombre, apellido, dni, cuil, legajo, legajo_visual) values
  ('00000000-0000-0000-0000-000000002001','00000000-0000-0000-0000-000000001001','admin','gerencia','Gere','Ncia',null,null,null,null),
  ('00000000-0000-0000-0000-000000002002','00000000-0000-0000-0000-000000001002','admin','administracion','Admi','Nistra',null,null,null,null),
  ('00000000-0000-0000-0000-000000002003','00000000-0000-0000-0000-000000001003','supervisor','supervisor','Super','Visor',null,null,null,null),
  ('00000000-0000-0000-0000-000000002010','00000000-0000-0000-0000-000000001010','guardia','vigilador','UNO','RENUNCIA','30111222','20301112223','L1','L1 Visual'),
  ('00000000-0000-0000-0000-000000002011','00000000-0000-0000-0000-000000001011','guardia','vigilador','DOS','DESPIDO','30222333','20302223334','L2','L2 Visual'),
  ('00000000-0000-0000-0000-000000002012','00000000-0000-0000-0000-000000001012','guardia','vigilador','TRES','CONCAUSA','30333444','20303334445','L3','L3 Visual'),
  ('00000000-0000-0000-0000-000000002013','00000000-0000-0000-0000-000000001013','guardia','vigilador','CUATRO','INACTIVAR','30444555','20304445556','L4','L4 Visual');
insert into public.legajo_datos_personales values
  ('00000000-0000-0000-0000-000000002010','2023-03-01'),
  ('00000000-0000-0000-0000-000000002011','2026-08-02'),
  ('00000000-0000-0000-0000-000000002012','2020-01-15');
insert into public.objetivos (id, nombre) values ('00000000-0000-0000-0000-00000000a001', 'CLUB');
