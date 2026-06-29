-- Se reemplaza el campo motivo por comentario para mejorar la usabilidad.
-- La auditoría continúa siendo automática; el comentario del usuario pasa
-- a ser opcional.

alter table turnos_auditoria
  rename column motivo to comentario;

alter table turnos_auditoria
  alter column comentario drop not null;

alter table registros_asistencia_auditoria
  rename column motivo to comentario;

alter table registros_asistencia_auditoria
  alter column comentario drop not null;
