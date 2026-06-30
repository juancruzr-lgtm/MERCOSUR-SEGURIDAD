-- Ampliar tipo_registro para incluir 'carga_manual'.
-- Representa una asistencia cargada administrativamente desde Reportes
-- por un admin o supervisor, cuando el guardia no pudo fichar
-- (sin internet, celular roto, olvido, etc.).
-- No es un fichaje GPS. No tiene coordenadas ni alertas automaticas.
-- Idempotente: recrea el constraint solo si no incluye 'carga_manual' ya.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'registros_asistencia_tipo_registro_check'
  ) then
    alter table registros_asistencia
      drop constraint registros_asistencia_tipo_registro_check;
  end if;

  alter table registros_asistencia
    add constraint registros_asistencia_tipo_registro_check
    check (tipo_registro in (
      'fichaje_gps',
      'presente_manual',
      'ausencia',
      'reemplazo',
      'carga_manual'
    ));
end $$;
