-- Rollback: quita la funcionalidad de anulación y corrección de fecha de registros manuales.
drop function if exists public.corregir_fecha_registro_manual(uuid, date, text);
drop function if exists public.anular_registro_manual(uuid, text);
alter table public.registros_asistencia
  drop column if exists registro_anulado_motivo,
  drop column if exists registro_anulado_por,
  drop column if exists registro_anulado_at;
