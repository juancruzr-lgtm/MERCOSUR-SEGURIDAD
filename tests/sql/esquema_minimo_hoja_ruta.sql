-- Agregado al esquema mínimo de programación para probar la hoja de ruta (solo local).
create table public.supervisores_guardia (id uuid primary key default gen_random_uuid(), supervisor_id uuid, supervisor_original_id uuid,
  fecha date, hora_inicio time, hora_fin time, zona text, rol_operativo text default 'supervisor', estado text, tipo_evento text default 'normal');
create table public.supervisor_route_points (id uuid primary key default gen_random_uuid(), supervisor_id uuid, client_ts timestamptz,
  latitud numeric, longitud numeric, precision_m integer, tipo_punto text, estado_movimiento text, supervision_id text,
  objetivo_cercano_id text, objetivo_distancia_m integer, distancia_desde_anterior_m integer,
  segundos_desde_anterior integer, turno_supervisor_id text, seq integer);
create table public.whatsapp_mensaje_estados (id uuid primary key default gen_random_uuid(), id_proveedor text, estado text,
  ocurrido_at timestamptz, error_codigo text, error_detalle text, destinatario text, created_at timestamptz default now());
create or replace function public.puede_ver_legajo_supervisores_actual() returns boolean language sql stable as $$ select false $$;
create or replace function public.tiene_delegacion_gerencia_actual() returns boolean language sql stable as $$ select false $$;
