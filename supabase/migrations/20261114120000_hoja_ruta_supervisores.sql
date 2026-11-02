-- Hoja de ruta de supervisores por WhatsApp (cierre de turno).
--
-- ── Pedido (JC, formato definitivo del 02/11/2026; diseño del 19/10) ─────────
-- 30 minutos después de terminar cada guardia de supervisor (aunque no haya
-- visitas), la app prepara la hoja de ruta con lo que ya registra y manda UN
-- solo mensaje de WhatsApp a cada destinatario de Gerencia (inicialmente Aldo
-- Monzón y Rodolfo Romero): HOJA DE RUTA, fecha, turno, supervisor y cada
-- visita "hora — objetivo" con sus novedades textuales completas debajo
-- ("Sin novedades" si no hay). Nada de alertas, estadísticas ni pendientes. Si no entra en el límite de Meta, no se manda ni se recorta: queda
-- "pendiente por longitud" y visible en la app.
--
-- NO es una alerta: no comparte tablas, rutas ni plantillas con el escalamiento
-- de puesto descubierto ni con las rondas. NO es una evaluación.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
--  · hojas_ruta: UNA por guardia (unique), congelada como evidencia. Guarda el
--    contenido, el texto completo para la app y el mensaje exacto de WhatsApp
--    (variables + longitud). envio_bloqueado = 'excede_longitud' si no entra.
--  · hoja_ruta_destinatarios: alta/baja solo por Gerencia, con cargo y motivo.
--    Ser destinatario activo es también el permiso explícito (y auditable:
--    quién lo dio, cuándo y por qué) para consultar las hojas y su recorrido.
--  · hoja_ruta_envios: un intento por fila (máx. 3 por destinatario). A lo
--    sumo UNO vivo o enviado por hoja y destinatario (unique parcial): dos
--    corridas simultáneas no pueden mandar dos mensajes. 'incierto' = se cortó
--    sin respuesta de Meta; no se reintenta solo.
--  · Vistas con el último estado de Meta (enviado/entregado/leído/falló) desde
--    whatsapp_mensaje_estados, por intento y por destinatario.
--  · hoja_ruta_puntos_guardia (solo servidor) y hoja_ruta_recorrido (para la
--    app, con el permiso de arriba): GPS sin lectura directa de la tabla.
--  · app_config: hoja_ruta_modo = 'desactivado' | 'prueba' | 'automatico';
--    hoja_ruta_destinatario_prueba; hoja_ruta_margen_cierre_min = 30.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
-- No carga destinatarios, no activa envíos, no crea el cron (ver
-- supabase/verificacion/hoja_ruta_activacion_NO_APLICAR_SIN_AUTORIZACION.sql).
-- No toca supervisiones, GPS, alertas, evaluaciones ni legajo.
--
-- Rollback: supabase/rollback/20261114120000_hoja_ruta_supervisores_rollback.sql

begin;

create table if not exists public.hojas_ruta (
  id                     uuid primary key default gen_random_uuid(),
  supervisor_guardia_id  uuid not null unique references public.supervisores_guardia(id) on delete restrict,
  supervisor_id          uuid not null references public.usuarios(id) on delete restrict,
  fecha                  date not null,
  inicio                 timestamptz not null,
  fin                    timestamptz not null,
  contenido              jsonb not null,
  texto                  text not null,
  mensaje                text not null,
  mensaje_variables      jsonb not null,
  mensaje_longitud       integer not null,
  envio_bloqueado        text check (envio_bloqueado in ('excede_longitud')),
  generada_at            timestamptz not null default now()
);
create index if not exists idx_hojas_ruta_supervisor on public.hojas_ruta (supervisor_id, fecha desc);
create index if not exists idx_hojas_ruta_bloqueadas on public.hojas_ruta (generada_at) where envio_bloqueado is not null;

create table if not exists public.hoja_ruta_destinatarios (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references public.usuarios(id) on delete restrict,
  cargo           text not null,
  activo          boolean not null default true,
  motivo          text not null check (length(btrim(motivo)) >= 3),
  creado_por      uuid not null references public.usuarios(id) on delete restrict,
  created_at      timestamptz not null default now(),
  desactivado_por uuid references public.usuarios(id) on delete restrict,
  desactivado_at  timestamptz
);
create unique index if not exists uq_hoja_ruta_destinatario_activo
  on public.hoja_ruta_destinatarios (usuario_id) where activo;

create table if not exists public.hoja_ruta_envios (
  id              uuid primary key default gen_random_uuid(),
  hoja_id         uuid not null references public.hojas_ruta(id) on delete restrict,
  destinatario_id uuid not null references public.usuarios(id) on delete restrict,
  intento         integer not null check (intento between 1 and 3),
  modo            text not null check (modo in ('prueba', 'automatico')),
  telefono        text,
  plantilla       text not null,
  estado          text not null check (estado in ('enviando', 'enviado', 'error', 'sin_telefono', 'incierto')),
  proveedor       text,
  id_proveedor    text,
  error           text,
  created_at      timestamptz not null default now(),
  terminado_at    timestamptz,
  unique (hoja_id, destinatario_id, intento)
);
-- Un solo mensaje por hoja y destinatario: a lo sumo un intento en curso,
-- enviado o incierto. Lo que exista ahí bloquea cualquier otro envío.
create unique index if not exists uq_hoja_ruta_envio_unico
  on public.hoja_ruta_envios (hoja_id, destinatario_id) where estado in ('enviando', 'enviado', 'incierto');
create index if not exists idx_hoja_ruta_envios_proveedor on public.hoja_ruta_envios (id_proveedor) where id_proveedor is not null;

comment on table public.hojas_ruta is
  'Hoja de ruta de cierre de una guardia de supervisor: objetivos recorridos y novedades textuales. Una por guardia, congelada como evidencia. No es una alerta ni una evaluación.';
comment on table public.hoja_ruta_envios is
  'Intentos de envío (un solo mensaje) de una hoja a un destinatario. Reservado (enviando) antes de llamar a Meta; incierto = sin respuesta de Meta, no se reintenta solo.';

create or replace view public.hoja_ruta_envios_estado
with (security_invoker = true) as
select e.*, st.estado as estado_meta, st.ocurrido_at as estado_meta_at, st.error_codigo, st.error_detalle
  from public.hoja_ruta_envios e
  left join lateral (
    select w.estado, w.ocurrido_at, w.error_codigo, w.error_detalle
      from public.whatsapp_mensaje_estados w
     where e.id_proveedor is not null and w.id_proveedor = e.id_proveedor
     order by case w.estado when 'failed' then 4 when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end desc,
              w.ocurrido_at desc nulls last
     limit 1
  ) st on true;

-- Por destinatario: el último intento y su estado en Meta.
create or replace view public.hoja_ruta_destinatario_estado
with (security_invoker = true) as
select distinct on (e.hoja_id, e.destinatario_id)
       e.hoja_id, e.destinatario_id,
       (select count(*) from public.hoja_ruta_envios x where x.hoja_id = e.hoja_id and x.destinatario_id = e.destinatario_id) as intentos,
       e.estado as estado_envio, e.estado_meta, e.estado_meta_at, e.error as ultimo_error, e.created_at as ultimo_intento_at
  from public.hoja_ruta_envios_estado e
 order by e.hoja_id, e.destinatario_id, e.intento desc;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Consultan: la lista de acceso al legajo de supervisores (#328) y los
-- destinatarios activos (permiso explícito y auditable). El supervisor y los
-- vigiladores no. Escritura: solo servidor y RPC de Gerencia.
create or replace function public.hoja_ruta_puede_ver_actual()
returns boolean language sql stable security definer set search_path to 'public', 'pg_catalog' as $fn$
  select auth.uid() is not null and (
    coalesce(public.puede_ver_legajo_supervisores_actual(), false)
    or exists (select 1 from public.hoja_ruta_destinatarios d join public.usuarios u on u.id = d.usuario_id
                where d.activo and u.auth_user_id = auth.uid() and u.estado = 'activo'))
$fn$;
revoke all on function public.hoja_ruta_puede_ver_actual() from public, anon;
grant execute on function public.hoja_ruta_puede_ver_actual() to authenticated;

alter table public.hojas_ruta enable row level security;
alter table public.hoja_ruta_destinatarios enable row level security;
alter table public.hoja_ruta_envios enable row level security;

revoke all on table public.hojas_ruta, public.hoja_ruta_destinatarios, public.hoja_ruta_envios from anon, authenticated;
grant select on table public.hojas_ruta, public.hoja_ruta_destinatarios, public.hoja_ruta_envios to authenticated;
revoke all on public.hoja_ruta_envios_estado, public.hoja_ruta_destinatario_estado from anon, authenticated;
grant select on public.hoja_ruta_envios_estado, public.hoja_ruta_destinatario_estado to authenticated;

drop policy if exists hojas_ruta_lectura on public.hojas_ruta;
create policy hojas_ruta_lectura on public.hojas_ruta for select to authenticated using (public.hoja_ruta_puede_ver_actual());
drop policy if exists hoja_ruta_destinatarios_lectura on public.hoja_ruta_destinatarios;
create policy hoja_ruta_destinatarios_lectura on public.hoja_ruta_destinatarios for select to authenticated using (public.hoja_ruta_puede_ver_actual());
drop policy if exists hoja_ruta_envios_lectura on public.hoja_ruta_envios;
create policy hoja_ruta_envios_lectura on public.hoja_ruta_envios for select to authenticated using (public.hoja_ruta_puede_ver_actual());

-- ── Destinatarios: solo Gerencia ────────────────────────────────────────────
create or replace function public.hoja_ruta_destinatario_guardar(p_usuario_id uuid, p_activo boolean, p_cargo text, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_actor uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  v_actor := (select u.id from public.usuarios u
               where u.auth_user_id = auth.uid() and u.estado = 'activo'
                 and (u.puesto_organizacional = 'gerencia' or coalesce(public.tiene_delegacion_gerencia_actual(), false)));
  if v_actor is null then raise exception 'Solo Gerencia define los destinatarios de la hoja de ruta'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'El motivo es obligatorio'; end if;
  if p_activo then
    if not exists (select 1 from public.usuarios u where u.id = p_usuario_id and u.estado = 'activo'
                     and u.rol not in ('guardia', 'vigilador')) then
      raise exception 'El destinatario debe ser personal de conducción activo';
    end if;
    if exists (select 1 from public.hoja_ruta_destinatarios d where d.usuario_id = p_usuario_id and d.activo) then
      return;
    end if;
    insert into public.hoja_ruta_destinatarios (usuario_id, cargo, activo, motivo, creado_por)
    values (p_usuario_id, coalesce(nullif(btrim(p_cargo), ''), 'Destinatario'), true, btrim(p_motivo), v_actor);
  else
    update public.hoja_ruta_destinatarios
       set activo = false, desactivado_por = v_actor, desactivado_at = now()
     where usuario_id = p_usuario_id and activo;
  end if;
end;
$fn$;
revoke all on function public.hoja_ruta_destinatario_guardar(uuid, boolean, text, text) from public, anon;
grant execute on function public.hoja_ruta_destinatario_guardar(uuid, boolean, text, text) to authenticated;

-- ── GPS ─────────────────────────────────────────────────────────────────────
-- La app no lee supervisor_route_points directo (corrección B, 19/10). Misma
-- vinculación que legajo_supervisor_recorrido (turno_supervisor_id = guardia).

-- Para el servidor (generación).
create or replace function public.hoja_ruta_puntos_guardia(p_guardia_id uuid)
returns table(ts timestamptz, precision_m integer, objetivo_cercano_id text, objetivo_distancia_m integer,
              distancia_desde_anterior_m integer, segundos_desde_anterior integer)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select p.client_ts, p.precision_m, p.objetivo_cercano_id, p.objetivo_distancia_m,
         p.distancia_desde_anterior_m, p.segundos_desde_anterior
    from public.supervisores_guardia g
    join public.supervisor_route_points p
      on p.supervisor_id = g.supervisor_id and p.turno_supervisor_id = g.id::text
   where g.id = p_guardia_id
   order by p.client_ts, p.seq
   limit 10000
$fn$;
revoke all on function public.hoja_ruta_puntos_guardia(uuid) from public, anon, authenticated;
grant execute on function public.hoja_ruta_puntos_guardia(uuid) to service_role;

-- Para la app: el recorrido de UNA hoja, a quien puede ver hojas de ruta
-- (lista del legajo #328 o destinatario activo). Mismas columnas que
-- legajo_supervisor_recorrido, para reutilizar el mapa.
create or replace function public.hoja_ruta_recorrido(p_hoja_id uuid)
returns table(ts timestamptz, lat numeric, lng numeric, precision_m integer, tipo_punto text, estado_movimiento text,
              segundos_desde_anterior integer, distancia_desde_anterior_m integer, objetivo_cercano_id text, supervision_id text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  if not public.hoja_ruta_puede_ver_actual() then
    raise exception 'sin permiso para ver la hoja de ruta' using errcode = '42501';
  end if;
  return query
  select p.client_ts, p.latitud, p.longitud, p.precision_m, p.tipo_punto, p.estado_movimiento,
         p.segundos_desde_anterior, p.distancia_desde_anterior_m, p.objetivo_cercano_id, p.supervision_id
    from public.hojas_ruta h
    join public.supervisores_guardia g on g.id = h.supervisor_guardia_id
    join public.supervisor_route_points p
      on p.supervisor_id = g.supervisor_id and p.turno_supervisor_id = g.id::text
   where h.id = p_hoja_id
   order by p.client_ts, p.seq
   limit 5000;
end;
$fn$;
revoke all on function public.hoja_ruta_recorrido(uuid) from public, anon;
grant execute on function public.hoja_ruta_recorrido(uuid) to authenticated;

-- ── Configuración: arranca DESACTIVADA ──────────────────────────────────────
insert into public.app_config (key, value) values
  ('hoja_ruta_modo', 'desactivado'),
  ('hoja_ruta_destinatario_prueba', ''),
  ('hoja_ruta_margen_cierre_min', '30')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
