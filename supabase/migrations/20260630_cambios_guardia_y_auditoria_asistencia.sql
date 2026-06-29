-- Commit 1: tablas base para cambios de guardia y auditoria de asistencia.
-- No activa RLS. No modifica ninguna fila existente.
-- No toca UI, reportes ni exportes (eso va en commits posteriores).

-- ── Cambio de guardia / reemplazo ────────────────────────────

create table if not exists cambios_guardia (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null references turnos(id) on delete cascade,
  objetivo_id uuid not null references objetivos(id),
  guardia_saliente_id uuid references usuarios(id),
  guardia_entrante_id uuid references usuarios(id),
  supervisor_id uuid not null references usuarios(id),
  fecha date not null,
  hora_real_cambio time not null,
  motivo text not null,
  observacion text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cambios_guardia_turno
  on cambios_guardia (turno_id);

create index if not exists idx_cambios_guardia_objetivo
  on cambios_guardia (objetivo_id, fecha);

-- Evidencia (fotos) del cambio de guardia, igual patron que
-- supervision_fotos: tabla separada con storage_path, sin foto_url
-- directo en cambios_guardia. El bucket de Storage
-- "cambios-guardia-evidencias" se crea manualmente en Supabase,
-- igual que se hizo con "supervision-fotos".

create table if not exists cambios_guardia_evidencias (
  id uuid primary key default gen_random_uuid(),
  cambio_guardia_id uuid not null references cambios_guardia(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_cambios_guardia_evidencias_cambio
  on cambios_guardia_evidencias (cambio_guardia_id);

-- ── Auditoria de ediciones sobre registros_asistencia ────────

create table if not exists registros_asistencia_auditoria (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid references registros_asistencia(id) on delete cascade,
  turno_id uuid not null references turnos(id),
  modificado_por uuid not null references usuarios(id),
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  motivo text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_registros_asistencia_auditoria_registro
  on registros_asistencia_auditoria (registro_id);

create index if not exists idx_registros_asistencia_auditoria_turno
  on registros_asistencia_auditoria (turno_id);

-- ── Tipo de registro en registros_asistencia ─────────────────
-- Default 'fichaje_gps' preserva el comportamiento actual: todo lo
-- que ya existe en la tabla sigue siendo fichaje real por GPS.

alter table registros_asistencia
  add column if not exists tipo_registro text not null default 'fichaje_gps';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'registros_asistencia_tipo_registro_check'
  ) then
    alter table registros_asistencia
      add constraint registros_asistencia_tipo_registro_check
      check (tipo_registro in ('fichaje_gps', 'presente_manual', 'ausencia', 'reemplazo'));
  end if;
end $$;
