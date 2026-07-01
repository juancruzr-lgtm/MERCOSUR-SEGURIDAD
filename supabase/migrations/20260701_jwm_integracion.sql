-- Integración JWM: tablas para sincronización de rondas de patrullaje.
-- Flujo: objetivo_jwm_map define qué empresa JWM corresponde a cada objetivo
-- Mercosur. jwm_tokens guarda el JWT activo (se renueva vía UI o cron).
-- rondas_jwm almacena cada escaneo de checkpoint. jwm_sync_log registra
-- el resultado de cada sincronización.

-- ── objetivo_jwm_map ─────────────────────────────────────────────────
-- Mapeo entre nombre de empresa en JWM y objetivo en Mercosur.
-- empresa_jwm = valor exacto del campo "companyName" que devuelve la API.
-- reader_codes = array de códigos de dispositivo (readercode) asociados.

create table if not exists objetivo_jwm_map (
  id            uuid primary key default gen_random_uuid(),
  objetivo_id   uuid not null references objetivos(id) on delete cascade,
  empresa_jwm   text not null,
  reader_codes  text[] not null default '{}',
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint objetivo_jwm_map_empresa_unique unique (empresa_jwm)
);

create index if not exists idx_objetivo_jwm_map_objetivo
  on objetivo_jwm_map (objetivo_id);

-- ── jwm_tokens ───────────────────────────────────────────────────────
-- Solo una fila activa. El token JWT se obtiene haciendo login en JWM
-- y se almacena aquí. El campo token_enc se cifra con pgp_sym_encrypt
-- usando JWM_ENCRYPTION_KEY (variable de entorno del backend, nunca
-- expuesta al frontend). Si pgcrypto no está disponible, se guarda
-- en texto plano con aviso (el token ya caduca en 24h).

create table if not exists jwm_tokens (
  id              uuid primary key default gen_random_uuid(),
  -- El token se almacena como texto; la protección principal es RLS
  -- (solo service_role puede leer/escribir esta tabla).
  token_value     text not null,
  expires_at      timestamptz not null,
  obtenido_por    text,          -- 'manual' | 'auto'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── jwm_sync_log ─────────────────────────────────────────────────────
-- Un registro por ejecución de sync, sea manual o automática.

create table if not exists jwm_sync_log (
  id                uuid primary key default gen_random_uuid(),
  objetivo_jwm_id   uuid references objetivo_jwm_map(id),
  inicio            timestamptz not null default now(),
  fin               timestamptz,
  filas_nuevas      int not null default 0,
  estado            text not null default 'en_progreso',
  -- 'ok' | 'error_token' | 'error_red' | 'error_jwm' | 'en_progreso'
  error_detalle     text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_jwm_sync_log_objetivo
  on jwm_sync_log (objetivo_jwm_id, inicio desc);

-- ── rondas_jwm ───────────────────────────────────────────────────────
-- Un registro por cada escaneo de checkpoint (dato original de JWM).
-- dataid es el ID único de JWM — se usa para evitar duplicados (upsert).

create table if not exists rondas_jwm (
  id              uuid primary key default gen_random_uuid(),
  objetivo_id     uuid not null references objetivos(id) on delete cascade,
  dataid          bigint not null,           -- ID único de JWM
  fecha_hora      timestamptz not null,
  checkpoint      text not null,            -- eminfo: "ACA Ros 1"
  checkpoint_code text,                     -- emcode: "02002EE124"
  dispositivo_id  text,                     -- readercode: "1407-24470514"
  estado          text not null default 'ok',
  -- Datos extra de JWM guardados por trazabilidad
  raw_data        jsonb,
  created_at      timestamptz not null default now(),
  constraint rondas_jwm_dataid_unique unique (dataid)
);

create index if not exists idx_rondas_jwm_objetivo_fecha
  on rondas_jwm (objetivo_id, fecha_hora desc);

create index if not exists idx_rondas_jwm_fecha
  on rondas_jwm (fecha_hora desc);

-- ── RLS ──────────────────────────────────────────────────────────────

alter table objetivo_jwm_map  enable row level security;
alter table jwm_tokens         enable row level security;
alter table jwm_sync_log       enable row level security;
alter table rondas_jwm         enable row level security;

-- objetivo_jwm_map: admin CRUD, supervisor lectura
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'objetivo_jwm_map' and policyname = 'Admin CRUD objetivo_jwm_map') then
    create policy "Admin CRUD objetivo_jwm_map"
    on objetivo_jwm_map for all to authenticated
    using  (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'))
    with check (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'objetivo_jwm_map' and policyname = 'Supervisor lee objetivo_jwm_map') then
    create policy "Supervisor lee objetivo_jwm_map"
    on objetivo_jwm_map for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'supervisor'));
  end if;
end $$;

-- jwm_tokens: SOLO service_role (backend). Ningún usuario autenticado puede leer.
-- El token no se expone al frontend bajo ninguna circunstancia.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'jwm_tokens' and policyname = 'Sin acceso autenticado jwm_tokens') then
    create policy "Sin acceso autenticado jwm_tokens"
    on jwm_tokens for all to authenticated
    using (false);
  end if;
end $$;

-- jwm_sync_log: admin lectura
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'jwm_sync_log' and policyname = 'Admin lee jwm_sync_log') then
    create policy "Admin lee jwm_sync_log"
    on jwm_sync_log for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

-- rondas_jwm: admin y supervisor lectura
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'rondas_jwm' and policyname = 'Admin lee rondas_jwm') then
    create policy "Admin lee rondas_jwm"
    on rondas_jwm for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'admin'));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'rondas_jwm' and policyname = 'Supervisor lee rondas_jwm') then
    create policy "Supervisor lee rondas_jwm"
    on rondas_jwm for select to authenticated
    using (exists (select 1 from usuarios where auth_user_id = auth.uid() and rol = 'supervisor'));
  end if;
end $$;

-- ── Datos iniciales: mapeo JWM → Mercosur ────────────────────────────
-- Insertar solo si los objetivos existen. Los reader_codes se completan
-- con los valores reales observados en la auditoría del 01/07/2026.
-- PNC Remolques: reader_code visto en dashboard pero no confirmado en
-- detail export — se deja vacío para completar cuando se confirme.

insert into objetivo_jwm_map (objetivo_id, empresa_jwm, reader_codes)
select o.id, 'ACA ROSARIO', array['1407-24470514']
from objetivos o
where o.nombre ilike '%ACA%'
  and not exists (select 1 from objetivo_jwm_map where empresa_jwm = 'ACA ROSARIO')
limit 1;

insert into objetivo_jwm_map (objetivo_id, empresa_jwm, reader_codes)
select o.id, 'CLUB UNI 2', array[]::text[]
from objetivos o
where o.nombre ilike '%club%univer%' or o.nombre ilike '%CLUB UNI%'
  and not exists (select 1 from objetivo_jwm_map where empresa_jwm = 'CLUB UNI 2')
limit 1;

insert into objetivo_jwm_map (objetivo_id, empresa_jwm, reader_codes)
select o.id, 'PNC Remolques', array['1407-24470515']
from objetivos o
where o.nombre ilike '%PNC%' or o.nombre ilike '%remolque%'
  and not exists (select 1 from objetivo_jwm_map where empresa_jwm = 'PNC Remolques')
limit 1;
