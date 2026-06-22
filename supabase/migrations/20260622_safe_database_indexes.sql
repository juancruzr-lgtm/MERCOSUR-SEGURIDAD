create index if not exists idx_turnos_guardia_fecha
  on turnos(guardia_id, fecha);

create index if not exists idx_turnos_objetivo_fecha
  on turnos(objetivo_id, fecha);

create index if not exists idx_asistencia_guardia
  on registros_asistencia(guardia_id);

create index if not exists idx_asistencia_turno
  on registros_asistencia(turno_id);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'registros_asistencia'
      and column_name = 'alerta_gps_ingreso'
  ) then
    create index if not exists idx_asistencia_gps_alerta
      on registros_asistencia(alerta_gps_ingreso)
      where alerta_gps_ingreso is not null;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'registros_asistencia'
      and column_name = 'gps_ingreso_estado'
  ) then
    create index if not exists idx_asistencia_gps_alerta
      on registros_asistencia(gps_ingreso_estado)
      where gps_ingreso_estado is not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'turnos'
      and column_name = 'estado_revision'
  ) then
    create index if not exists idx_turnos_estado_revision
      on turnos(estado_revision)
      where estado_revision is not null;
  end if;
end $$;
