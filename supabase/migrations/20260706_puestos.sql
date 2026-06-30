/*
Arquitectura: Puesto como unidad operativa dentro de un Objetivo.

- Objetivo sigue siendo la unidad de reporte (objetivo_id no se toca
  en ninguna tabla existente).
- Puesto es la posicion/garita concreta dentro de un objetivo
  (ej. "Ingreso Principal", "Estacionamiento").
- Todo objetivo existente recibe un puesto "Principal" via backfill
  en la migracion siguiente, para no romper turnos ni reportes.
*/

create table if not exists puestos (
  id uuid primary key default gen_random_uuid(),
  objetivo_id uuid not null references objetivos(id),
  nombre text not null,
  activo boolean not null default true,
  orden integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (objetivo_id, nombre)
);

create index if not exists idx_puestos_objetivo
  on puestos (objetivo_id);

insert into puestos (objetivo_id, nombre, orden)
select o.id, 'Principal', 1
from objetivos o
where not exists (
  select 1 from puestos p where p.objetivo_id = o.id and p.nombre = 'Principal'
);
