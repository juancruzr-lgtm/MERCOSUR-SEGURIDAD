-- Esqueleto mínimo para probar la reconciliación repo ↔ producción
-- (20261205100000 / 100100 / 100200). Sólo las columnas que usan las
-- funciones en prueba. Las funciones "de apoyo" son stubs o copias de
-- producción (04/11/2026) según se indica.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

create table public.usuarios (
  id uuid primary key default gen_random_uuid(), auth_user_id uuid unique,
  estado text default 'activo', rol text, nombre text, apellido text);
create table public.objetivos (
  id uuid primary key default gen_random_uuid(), nombre text, estado text default 'activo');
create table public.puestos (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id),
  nombre text, activo boolean default true, orden integer, unique (id, objetivo_id));
create table public.turnos (
  id uuid primary key default gen_random_uuid(), guardia_id uuid references public.usuarios(id),
  objetivo_id uuid references public.objetivos(id), puesto_id uuid, fecha date,
  hora_inicio time, hora_fin time, estado text default 'programado',
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.turnos_auditoria (
  id uuid primary key default gen_random_uuid(), turno_id uuid, modificado_por uuid, campo text,
  valor_anterior text, valor_nuevo text, comentario text, created_at timestamptz default now());
create table public.registros_asistencia (
  id uuid primary key default gen_random_uuid(), turno_id uuid references public.turnos(id),
  guardia_id uuid, guardia_final_id uuid, objetivo_final_id uuid,
  hora_entrada_real time, hora_salida_real time, hora_entrada_final time, hora_salida_final time,
  comentario_final text, horas_trabajadas numeric, horas_liquidables numeric,
  tipo_registro text, origen_cobertura text, cierre_automatico boolean default false,
  cobertura_anulada_at timestamptz, registro_anulado_at timestamptz, created_at timestamptz default now());
create table public.registros_asistencia_auditoria (
  id uuid primary key default gen_random_uuid(), registro_id uuid, turno_id uuid, modificado_por uuid,
  campo text, valor_anterior text, valor_nuevo text, comentario text);
create table public.correccion_turno_manual_log (
  operacion_id uuid primary key, registro_id uuid, turno_id uuid, ejecutado_por uuid,
  solicitud_json jsonb, cambios_aplicados jsonb, resultado_json jsonb);
create table public.solicitudes_modificacion_planilla (
  id uuid primary key default gen_random_uuid(), turno_id uuid, empleado_id uuid,
  registro_asistencia_id uuid, auth_user_id uuid, texto text, entrada_visible time,
  salida_visible time, horas_visibles numeric, salida_automatica boolean, estado text default 'pendiente');

-- Tablas con trigger set_updated_at (como novedades_laborales / rondas_base en producción)
create table public.novedades_laborales (
  id uuid primary key default gen_random_uuid(), detalle text, updated_at timestamptz default now());
create table public.rondas_base (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid, puesto_id uuid,
  activo boolean default true, updated_at timestamptz default now());
create table public.ronda_pausas (
  id uuid primary key default gen_random_uuid(), ronda_base_id uuid, objetivo_id uuid, puesto_id uuid,
  pausada_por uuid, pausada_at timestamptz default now(), motivo text, hasta_at timestamptz,
  activa boolean default true, causa text);
create table public.ronda_alertas (
  id uuid primary key default gen_random_uuid(), ronda_base_id uuid, estado text);

-- Agente documental
create table public.repositorio_documental (
  documento_uid uuid, version_actual integer, agente_id text, origen text, empresa text,
  tipo_documento text, nombre_archivo text, extension text, mime_type text, ruta_relativa text,
  tamano_bytes bigint, hash_sha256 text, fecha_creacion_archivo timestamptz,
  fecha_modificacion_archivo timestamptz, detectado_por_primera_vez_at timestamptz,
  detectado_por_ultima_vez_at timestamptz, disponible boolean, estado_indexacion text,
  categoria text, etiquetas text[], ultimo_error text, actualizado_at timestamptz,
  unique (agente_id, ruta_relativa));

-- set_updated_at: copia de producción (md5 608ef48381668ad5cc300914a52c93f5, cuerpo CRLF)
do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;
create trigger trg_novedades_laborales_updated_at before update on public.novedades_laborales
  for each row execute function public.set_updated_at();
create trigger trg_rondas_base_updated_at before update on public.rondas_base
  for each row execute function public.set_updated_at();

-- Trigger de 20260728100000 (sólo el trigger: la función la pone la migración foto)
create function public.turnos_completar_puesto() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_turnos_completar_puesto before insert on public.turnos
  for each row execute function public.turnos_completar_puesto();

-- Stubs de alcance y cálculo
create function public.puede_administrar_rondas_objetivo(uuid) returns boolean language sql stable as $$ select true $$;
create function public.calcular_horas_liquidables(time, time, time, time) returns numeric language sql immutable as $$ select 8::numeric $$;
create function public.calcular_horas_reconocidas(time, time, time, time) returns numeric language sql immutable as $$ select 8::numeric $$;
