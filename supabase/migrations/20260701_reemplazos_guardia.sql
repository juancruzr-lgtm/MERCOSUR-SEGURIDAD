-- Commit 2: ajusta cambios_guardia (pase normal) y agrega reemplazos_guardia
-- (reemplazo total / cobertura parcial dentro de un turno).
-- No activa RLS. No toca UI, reportes ni exportes.

-- ── Ajustes a cambios_guardia (pase normal entre turnos) ─────

-- turno_id se mantiene por compatibilidad (no se borra, no se renombra).
-- Se agregan referencias explicitas al turno que termina y al que empieza.
alter table cambios_guardia
  add column if not exists turno_saliente_id uuid references turnos(id);

alter table cambios_guardia
  add column if not exists turno_entrante_id uuid references turnos(id);

create index if not exists idx_cambios_guardia_turno_saliente
  on cambios_guardia (turno_saliente_id);

create index if not exists idx_cambios_guardia_turno_entrante
  on cambios_guardia (turno_entrante_id);

-- El pase normal entre turnos no exige motivo. Motivo obligatorio
-- solo se pedira desde la UI cuando el cambio se marque como irregular.
alter table cambios_guardia
  alter column motivo drop not null;

-- ── Reemplazo total / cobertura parcial dentro de un turno ───

create table if not exists reemplazos_guardia (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null references turnos(id) on delete cascade,
  objetivo_id uuid not null references objetivos(id),
  guardia_titular_id uuid references usuarios(id),
  guardia_reemplazante_id uuid not null references usuarios(id),
  supervisor_id uuid not null references usuarios(id),
  tipo text not null check (tipo in ('reemplazo_total', 'cobertura_parcial')),
  tramo_inicio time,
  tramo_fin time,
  motivo text not null,
  observacion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reemplazos_guardia_turno
  on reemplazos_guardia (turno_id);

create index if not exists idx_reemplazos_guardia_objetivo
  on reemplazos_guardia (objetivo_id, created_at desc);

-- Evidencia (fotos) del reemplazo/cobertura, mismo patron que
-- cambios_guardia_evidencias y supervision_fotos: tabla separada con
-- storage_path, sin foto_url suelto. El bucket de Storage
-- "reemplazos-guardia-evidencias" se crea manualmente en Supabase.

create table if not exists reemplazos_guardia_evidencias (
  id uuid primary key default gen_random_uuid(),
  reemplazo_id uuid not null references reemplazos_guardia(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_reemplazos_guardia_evidencias_reemplazo
  on reemplazos_guardia_evidencias (reemplazo_id);
