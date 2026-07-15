-- ════════════════════════════════════════════════════════════════════
-- 20260715_os_sessions_app_config.sql
-- Sobre de sesión y tabla de configuración del Sistema Operativo.
-- os_sessions: registro por sesión de usuario (dispositivo, red, batería).
-- app_config: feature flags y parámetros operativos del sistema.
-- Sin FK a tablas de dominio.
-- ════════════════════════════════════════════════════════════════════

-- ── os_sessions ───────────────────────────────────────────────────────

create table if not exists os_sessions (
  id                  uuid        primary key default gen_random_uuid(),

  -- ── Quién ────────────────────────────────────────────────────────
  -- Sin FK: el registro de sesión sobrevive a cambios en usuarios.
  user_id             uuid        not null,
  user_rol            text        not null
                                  check (user_rol in ('guardia','vigilador','supervisor','admin')),

  -- ── Timing ───────────────────────────────────────────────────────
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  duration_s          integer     check (duration_s is null or duration_s >= 0),

  -- ── Estadísticas de la sesión (actualizadas al cerrar) ───────────
  event_count         integer     not null default 0 check (event_count >= 0),

  -- ── Dispositivo ──────────────────────────────────────────────────
  device_type         text,        -- 'mobile' | 'tablet' | 'desktop'
  device_model        text,        -- 'Samsung Galaxy A23'
  os_name             text,        -- 'Android' | 'iOS' | 'Windows'
  os_version          text,        -- '14.0.0'
  browser_name        text,        -- 'Chrome' | 'Safari'
  browser_version     text,        -- '125.0.0'
  app_version         text,

  -- ── Batería ──────────────────────────────────────────────────────
  battery_start_pct   smallint    check (battery_start_pct is null or (battery_start_pct >= 0 and battery_start_pct <= 100)),
  battery_end_pct     smallint    check (battery_end_pct   is null or (battery_end_pct   >= 0 and battery_end_pct   <= 100)),

  -- ── Red ──────────────────────────────────────────────────────────
  network_start       text,        -- 'wifi' | '4g' | '5g' | '3g' | 'offline'
  network_end         text,

  -- ── Timestamps ───────────────────────────────────────────────────
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Índices ───────────────────────────────────────────────────────────
create index if not exists idx_os_user_date  on os_sessions (user_id,   started_at desc);
create index if not exists idx_os_rol_date   on os_sessions (user_rol,  started_at desc);
create index if not exists idx_os_started    on os_sessions (started_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────
alter table os_sessions enable row level security;

-- INSERT: usuario autenticado inserta solo sesiones propias,
-- validando user_id + user_rol contra su registro en usuarios.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_sessions'
      and policyname = 'Usuario inserta sus propias sesiones'
  ) then
    create policy "Usuario inserta sus propias sesiones"
    on os_sessions for insert to authenticated
    with check (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id    = os_sessions.user_id
          and usuarios.rol   = os_sessions.user_rol
      )
    );
  end if;
end $$;

-- UPDATE: usuario actualiza solo sus propias sesiones (cierre, event_count, batería final).
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_sessions'
      and policyname = 'Usuario actualiza sus propias sesiones'
  ) then
    create policy "Usuario actualiza sus propias sesiones"
    on os_sessions for update to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id = os_sessions.user_id
      )
    )
    with check (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id = os_sessions.user_id
      )
    );
  end if;
end $$;

-- SELECT: usuario ve solo sus propias sesiones.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_sessions'
      and policyname = 'Usuario lee sus propias sesiones'
  ) then
    create policy "Usuario lee sus propias sesiones"
    on os_sessions for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.id = os_sessions.user_id
      )
    );
  end if;
end $$;

-- SELECT: admin y supervisor leen todas las sesiones.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_sessions'
      and policyname = 'Admin y supervisor leen todas las sesiones'
  ) then
    create policy "Admin y supervisor leen todas las sesiones"
    on os_sessions for select to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol in ('admin', 'supervisor')
      )
    );
  end if;
end $$;

-- ── app_config ────────────────────────────────────────────────────────

create table if not exists app_config (
  key         text        primary key,
  value       text        not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid                               -- nullable: uuid del admin que modificó
);

-- Valores iniciales.
-- ON CONFLICT DO NOTHING: idempotente, no sobreescribe cambios manuales.
insert into app_config (key, value, description) values
  ('telemetry_enabled',
   'true',
   'Activa o desactiva toda la captura de telemetría. false = el hook no envía nada.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('supervisor_gps_enabled',
   'true',
   'Activa o desactiva la captura de GPS de supervisores. Independiente de telemetry_enabled.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('telemetry_batch_seconds',
   '30',
   'Segundos entre cada flush del batch de eventos al servidor.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('telemetry_retention_days',
   '730',
   'Días de retención de os_events. Referencia para jobs de limpieza futuros.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('supervisor_gps_interval_moving_seconds',
   '60',
   'Intervalo máximo en segundos entre puntos GPS cuando el supervisor está en movimiento.')
on conflict (key) do nothing;

insert into app_config (key, value, description) values
  ('supervisor_gps_min_distance_m',
   '100',
   'Distancia mínima en metros para forzar un nuevo punto GPS aunque no haya pasado el intervalo.')
on conflict (key) do nothing;

-- ── RLS app_config ────────────────────────────────────────────────────
alter table app_config enable row level security;

-- SELECT: cualquier usuario autenticado puede leer la configuración.
-- El hook necesita leer telemetry_enabled al iniciar la sesión.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'app_config'
      and policyname = 'Autenticados leen configuración'
  ) then
    create policy "Autenticados leen configuración"
    on app_config for select to authenticated
    using (true);
  end if;
end $$;

-- INSERT: solo admin.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'app_config'
      and policyname = 'Admin inserta configuración'
  ) then
    create policy "Admin inserta configuración"
    on app_config for insert to authenticated
    with check (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol = 'admin'
      )
    );
  end if;
end $$;

-- UPDATE: solo admin.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'app_config'
      and policyname = 'Admin actualiza configuración'
  ) then
    create policy "Admin actualiza configuración"
    on app_config for update to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol = 'admin'
      )
    )
    with check (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol = 'admin'
      )
    );
  end if;
end $$;

-- DELETE: solo admin.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'app_config'
      and policyname = 'Admin elimina configuración'
  ) then
    create policy "Admin elimina configuración"
    on app_config for delete to authenticated
    using (
      exists (
        select 1 from usuarios
        where usuarios.auth_user_id = auth.uid()
          and usuarios.rol = 'admin'
      )
    );
  end if;
end $$;
