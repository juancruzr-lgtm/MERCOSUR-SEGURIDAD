-- ════════════════════════════════════════════════════════════════════
-- 20260715_supervisor_route_points.sql
-- Recorrido GPS de supervisores — Fase 1.
-- Solo supervisores. Sin FK a tablas de dominio.
-- Sin PostGIS: distancias calculadas en cliente (Haversine).
-- Append-only para clientes autenticados.
-- Configuración operativa en app_config (ya cargada en Commit 2).
-- ════════════════════════════════════════════════════════════════════

create table if not exists supervisor_route_points (

  -- ── Identificación ───────────────────────────────────────────────
  id                         uuid        primary key default gen_random_uuid(),

  -- ── Contexto de sesión ───────────────────────────────────────────
  -- Sin FK: el punto sobrevive a cambios en os_sessions o usuarios.
  session_id                 uuid        not null,
  supervisor_id              uuid        not null,

  -- ── Timestamps ───────────────────────────────────────────────────
  -- client_ts: momento real en el dispositivo (antes del flush).
  -- created_at: momento de llegada al servidor.
  client_ts                  timestamptz not null,
  created_at                 timestamptz not null default now(),

  -- ── Posición ─────────────────────────────────────────────────────
  latitud                    numeric(10,7) not null
                             check (latitud  between -90  and 90),
  longitud                   numeric(10,7) not null
                             check (longitud between -180 and 180),
  precision_m                integer
                             check (precision_m is null or precision_m >= 0),
  velocidad_m_s              numeric
                             check (velocidad_m_s is null or velocidad_m_s >= 0),
  rumbo_grados               numeric
                             check (rumbo_grados is null or (rumbo_grados >= 0 and rumbo_grados <= 360)),
  altitud_m                  numeric,

  -- ── Clasificación del punto ──────────────────────────────────────
  -- tipo_punto describe el motivo por el que se registró este punto.
  tipo_punto                 text        not null
                             check (tipo_punto in (
                               'session_start',   -- primer punto al iniciar turno
                               'moving',          -- supervisor en movimiento
                               'stopped',         -- supervisor detenido (fuera de objetivo)
                               'objetivo_enter',  -- entrada al radio de un objetivo
                               'objetivo_inside', -- punto periódico dentro del objetivo
                               'supervision',     -- punto registrado durante supervisión
                               'objetivo_exit',   -- salida del radio de un objetivo
                               'session_end',     -- último punto al cerrar turno
                               'gps_recovered',   -- GPS volvió después de pérdida
                               'gps_error'        -- falla o denegación de GPS
                             )),

  -- ── Estado de la máquina de movimiento ──────────────────────────
  estado_movimiento          text
                             check (estado_movimiento is null or estado_movimiento in (
                               'MOVING',
                               'STOPPED',
                               'IN_OBJETIVO',
                               'UNKNOWN'
                             )),

  -- ── Contexto operacional (sin FK) ────────────────────────────────
  objetivo_cercano_id        text,
  objetivo_distancia_m       integer
                             check (objetivo_distancia_m is null or objetivo_distancia_m >= 0),
  supervision_id             text,
  turno_supervisor_id        text,

  -- ── Relación temporal con el punto anterior ──────────────────────
  -- Permite calcular km y tiempo en cliente sin recomputar desde cero.
  seq                        integer     not null
                             check (seq >= 0),
  punto_anterior_id          uuid,
  distancia_desde_anterior_m integer
                             check (distancia_desde_anterior_m is null or distancia_desde_anterior_m >= 0),
  segundos_desde_anterior    integer
                             check (segundos_desde_anterior is null or segundos_desde_anterior >= 0),

  -- ── Estado del dispositivo en el momento del punto ───────────────
  battery_pct                smallint
                             check (battery_pct is null or (battery_pct >= 0 and battery_pct <= 100)),
  battery_charging           boolean,
  network_type               text,

  -- ── Payload extensible para datos futuros ────────────────────────
  metadata                   jsonb
);

-- ── Índices ───────────────────────────────────────────────────────────

-- Consultas principales de recorrido: todos los puntos de un supervisor por fecha
create index if not exists idx_srp_supervisor_ts
  on supervisor_route_points (supervisor_id, client_ts desc);

-- Reconstrucción ordenada de una sesión (para el mapa del CGO)
create index if not exists idx_srp_session_seq
  on supervisor_route_points (session_id, seq);

-- Queries de rango temporal global (jobs de limpieza, auditoría)
create index if not exists idx_srp_created_at
  on supervisor_route_points (created_at desc);

-- Historial de visitas a un objetivo en particular
create index if not exists idx_srp_objetivo_ts
  on supervisor_route_points (objetivo_cercano_id, client_ts desc)
  where objetivo_cercano_id is not null;

-- Filtrar por tipo de punto (entradas/salidas a objetivos, supervisiones, errores)
create index if not exists idx_srp_tipo_ts
  on supervisor_route_points (tipo_punto, client_ts desc);

-- Índice parcial: puntos de error GPS (diagnóstico de dispositivos problemáticos)
create index if not exists idx_srp_gps_error
  on supervisor_route_points (supervisor_id, client_ts desc)
  where tipo_punto = 'gps_error';

-- Índice parcial: puntos de supervisión (el más consultado en analytics)
create index if not exists idx_srp_supervision
  on supervisor_route_points (supervisor_id, client_ts desc)
  where tipo_punto = 'supervision';

-- Índice geográfico simple: permite bounding-box queries sobre el mapa
-- (latitud BETWEEN X1 AND X2 AND longitud BETWEEN Y1 AND Y2).
-- Sin PostGIS: no soporta distancias ni círculos, solo rectángulos de mapa.
-- Útil para: cargar puntos visibles en un viewport, filtrar por zona.
create index if not exists idx_srp_geo
  on supervisor_route_points (latitud, longitud);

-- ── RLS ───────────────────────────────────────────────────────────────
alter table supervisor_route_points enable row level security;

-- INSERT: solo supervisores autenticados, solo sus propios puntos.
-- Valida usuario.id = supervisor_id Y que el rol sea supervisor.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervisor_route_points'
      and policyname = 'Supervisor inserta sus propios puntos GPS'
  ) then
    create policy "Supervisor inserta sus propios puntos GPS"
    on supervisor_route_points for insert to authenticated
    with check (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id           = supervisor_route_points.supervisor_id
          and usuarios.rol          = 'supervisor'
      )
    );
  end if;
end $$;

-- SELECT PROPIO: supervisor lee solo sus propios recorridos.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervisor_route_points'
      and policyname = 'Supervisor lee sus propios recorridos'
  ) then
    create policy "Supervisor lee sus propios recorridos"
    on supervisor_route_points for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id           = supervisor_route_points.supervisor_id
          and usuarios.rol          = 'supervisor'
      )
    );
  end if;
end $$;

-- SELECT GLOBAL: solo admins. Supervisores no leen recorridos de otros supervisores.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'supervisor_route_points'
      and policyname = 'Admin lee todos los recorridos'
  ) then
    create policy "Admin lee todos los recorridos"
    on supervisor_route_points for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol          = 'admin'
      )
    );
  end if;
end $$;

-- Sin políticas UPDATE ni DELETE para clientes autenticados.
-- Append-only para clientes autenticados; service_role y mantenimiento
-- interno conservan capacidad administrativa.

-- ── NOTA OPERATIVA ────────────────────────────────────────────────────
-- La captura GPS se controla desde app_config:
--   supervisor_gps_enabled              = true
--   supervisor_gps_interval_moving_s    = 60
--   supervisor_gps_min_distance_m       = 100
-- Estas claves ya existen en la migración 20260715_os_sessions_app_config.sql.
-- No se agregan aquí para no duplicar.
