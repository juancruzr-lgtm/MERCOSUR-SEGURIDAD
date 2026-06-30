/*
turnos.objetivo_id se mantiene sin cambios (no se redefine la
relacion principal de turnos). puesto_id es un dato adicional,
nullable, que se va a usar cuando un objetivo tenga mas de un puesto.

Backfill: todo turno existente queda asociado al puesto "Principal"
de su objetivo, creado en la migracion anterior.
*/

alter table turnos
  add column if not exists puesto_id uuid references puestos(id);

update turnos t
set puesto_id = p.id
from puestos p
where p.objetivo_id = t.objetivo_id
  and p.nombre = 'Principal'
  and t.puesto_id is null;
