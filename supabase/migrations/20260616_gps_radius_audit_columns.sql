alter table registros_asistencia add column if not exists distancia_ingreso_metros numeric;
alter table registros_asistencia add column if not exists gps_ingreso_estado text;
alter table registros_asistencia add column if not exists distancia_egreso_metros numeric;
alter table registros_asistencia add column if not exists gps_egreso_estado text;
