-- ════════════════════════════════════════════════════════════════════
-- 20260715_os_events.sql
-- Event Store del Sistema Operativo Mercosur.
-- Append-only para clientes autenticados; service_role y mantenimiento
-- interno conservan capacidad administrativa.
-- Sin FK a tablas de dominio (objetivos, turnos, usuarios).
-- Sin particionado mensual: tabla simple con índice en created_at.
-- Particionado disponible como optimización en año 2-3.
-- ════════════════════════════════════════════════════════════════════

create table if not exists os_events (
  id              uuid        primary key default gen_random_uuid(),

  -- ── Encadenamiento ─────────────────────────────────────────────
  session_id      uuid        not null,
  seq             integer     not null default 0 check (seq >= 0),
  parent_id       uuid,

  -- ── Quién ──────────────────────────────────────────────────────
  user_id         uuid        not null,
  user_rol        text        not null
                              check (user_rol in ('guardia','vigilador','supervisor','admin')),

  -- ── Qué ────────────────────────────────────────────────────────
  event_name      text        not null,
  event_category  text        not null,
  screen          text,
  screen_section  text,

  -- ── Contexto operacional (IDs como text, sin FK) ───────────────
  objetivo_id     text,
  turno_id        text,
  supervision_id  text,
  registro_id     text,
  puesto_id       text,

  -- ── GPS en el momento exacto del evento ────────────────────────
  gps_lat         numeric(10,7),
  gps_lng         numeric(10,7),
  gps_accuracy_m  integer     check (gps_accuracy_m  is null or gps_accuracy_m  >= 0),
  gps_distance_m  integer     check (gps_distance_m  is null or gps_distance_m  >= 0),
  gps_status      text,
  gps_age_ms      integer     check (gps_age_ms      is null or gps_age_ms      >= 0),
  gps_acq_ms      integer     check (gps_acq_ms      is null or gps_acq_ms      >= 0),

  -- ── Estado del dispositivo ──────────────────────────────────────
  network_type    text,
  network_rtt_ms  integer,
  battery_pct     smallint    check (battery_pct is null or (battery_pct >= 0 and battery_pct <= 100)),
  battery_charg   boolean,

  -- ── Timing ─────────────────────────────────────────────────────
  client_ts       timestamptz not null,
  duration_ms     integer     check (duration_ms is null or duration_ms >= 0),

  -- ── Valores genéricos ──────────────────────────────────────────
  value_num       numeric,
  value_text      text,
  value_json      jsonb,

  -- ── Error (pantalla + componente + función + código + mensaje) ──
  -- Sin stack trace completo.
  err_screen      text,
  err_component   text,
  err_function    text,
  err_code        text,
  err_message     text,

  -- ── Cadena causal: últimos 5 event_name de la sesión ───────────
  -- Completado automáticamente por el hook useTelemetry.
  prev_events     text[],

  -- ── Versión de la app ──────────────────────────────────────────
  app_version     text,

  -- ── Timestamp del servidor ─────────────────────────────────────
  created_at      timestamptz not null default now()
);

-- ── Índices ───────────────────────────────────────────────────────────
create index if not exists idx_oe_date     on os_events (created_at desc);
create index if not exists idx_oe_session  on os_events (session_id, seq);
create index if not exists idx_oe_user     on os_events (user_id, created_at desc);
create index if not exists idx_oe_event    on os_events (event_name, created_at desc);
create index if not exists idx_oe_cat      on os_events (event_category, created_at desc);
create index if not exists idx_oe_objetivo on os_events (objetivo_id) where objetivo_id is not null;
create index if not exists idx_oe_errors   on os_events (created_at desc) where err_code is not null;

-- ── RLS ───────────────────────────────────────────────────────────────
alter table os_events enable row level security;

-- INSERT: usuario autenticado inserta solo eventos donde user_id
-- coincide con su propio usuarios.id Y user_rol coincide con su rol real.
-- Previene que un usuario inserte eventos con rol diferente al suyo.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_events'
      and policyname = 'Usuario inserta sus propios eventos'
  ) then
    create policy "Usuario inserta sus propios eventos"
    on os_events for insert to authenticated
    with check (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id        = os_events.user_id
          and usuarios.rol       = os_events.user_rol
      )
    );
  end if;
end $$;

-- SELECT: usuario ve solo sus propios eventos.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_events'
      and policyname = 'Usuario lee sus propios eventos'
  ) then
    create policy "Usuario lee sus propios eventos"
    on os_events for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id = os_events.user_id
      )
    );
  end if;
end $$;

-- SELECT: admin y supervisor leen todos los eventos.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_events'
      and policyname = 'Admin y supervisor leen todos los eventos'
  ) then
    create policy "Admin y supervisor leen todos los eventos"
    on os_events for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol in ('admin', 'supervisor')
      )
    );
  end if;
end $$;

-- Sin políticas UPDATE ni DELETE para roles autenticados.
-- Append-only para clientes autenticados; service_role y mantenimiento
-- interno conservan capacidad administrativa.
