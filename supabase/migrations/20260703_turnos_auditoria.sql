/*
Decision de arquitectura - Julio 2026

Esta tabla registra las modificaciones manuales realizadas
sobre turnos.

Objetivos:

- Auditoría completa.
- Motivo obligatorio.
- Historial de cambios.

No modifica la lógica operativa.

No calcula horas.

No modifica liquidaciones.

No modifica facturación.

El turno continúa representando únicamente la planificación.
*/

create table if not exists turnos_auditoria (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null references turnos(id) on delete cascade,
  modificado_por uuid not null references usuarios(id),
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  motivo text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_turnos_auditoria_turno
  on turnos_auditoria (turno_id);
