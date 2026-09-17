-- AFIP/ARCA — Fase 1: corroboración diaria de empleados contra el Padrón A13.
--
-- Tres tablas, TODAS de acceso exclusivo del servidor (service_role). El cron
-- escribe con la service key; la UI lee a través de una ruta API autenticada que
-- valida capacidad. No se abren policies para `authenticated`: estas tablas NO se
-- leen ni escriben directo desde el cliente.
--
-- Recordatorio (memoria del proyecto): toda tabla nueva sale con DELETE/TRUNCATE
-- para `authenticated` por DEFAULT PRIVILEGES → hay que REVOCAR explícitamente.

-- 1) Caché del Ticket de Acceso (TA) de WSAA. Dura ~12 h y WSAA NO reemite uno
--    nuevo mientras el vigente siga vivo ("El CEE ya posee un TA valido"), así
--    que hay que guardarlo entre invocaciones serverless.
create table if not exists public.afip_ta_cache (
  servicio    text primary key,
  token       text        not null,
  sign        text        not null,
  expira      timestamptz not null,
  actualizado timestamptz not null default now()
);

-- 2) Última foto del Padrón A13 por usuario. Se upsertea en cada corrida (una
--    fila por empleado). `novedades` acumula las banderas detectadas.
create table if not exists public.afip_padron_snapshot (
  usuario_id    uuid primary key references public.usuarios(id) on delete cascade,
  cuil          text,
  existe        boolean     not null default false,
  estado_clave  text,        -- ACTIVO, etc. (estadoClave del padrón)
  tipo_persona  text,        -- FISICA | JURIDICA
  apellido      text,
  nombre        text,
  razon_social  text,
  direccion     text,        -- ej. "MENDOZA 1744"
  localidad     text,
  cod_postal    text,
  provincia     text,        -- descripción, ej. "SANTA FE"
  domicilio     jsonb,       -- domicilio completo tal cual vino
  novedades     text[]      not null default '{}',
  error         text,
  consultado_at timestamptz not null default now()
);

-- 3) Resumen de cada corrida (auditoría de "corroboró 1 vez por día").
create table if not exists public.afip_corroboracion_corrida (
  id            uuid primary key default gen_random_uuid(),
  iniciada_at   timestamptz not null default now(),
  finalizada_at timestamptz,
  total         int     not null default 0,   -- empleados considerados
  consultados   int     not null default 0,   -- consultas al padrón hechas
  con_novedad   int     not null default 0,
  errores       int     not null default 0,
  ok            boolean,
  detalle       jsonb
);

create index if not exists afip_padron_snapshot_novedad_idx
  on public.afip_padron_snapshot using gin (novedades);
create index if not exists afip_corroboracion_corrida_iniciada_idx
  on public.afip_corroboracion_corrida (iniciada_at desc);

-- Cerrar el acceso: RLS prendida y sin policies para el cliente. Sólo el
-- service_role (que hace bypass de RLS) puede tocar estas tablas.
alter table public.afip_ta_cache            enable row level security;
alter table public.afip_padron_snapshot     enable row level security;
alter table public.afip_corroboracion_corrida enable row level security;

revoke all on public.afip_ta_cache            from anon, authenticated;
revoke all on public.afip_padron_snapshot     from anon, authenticated;
revoke all on public.afip_corroboracion_corrida from anon, authenticated;
