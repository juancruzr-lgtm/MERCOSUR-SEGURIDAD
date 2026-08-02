-- Rollback estructural de la anulación de cobertura manual.
-- ADVERTENCIA: elimina metadatos de anulaciones ya registradas. Antes de usarlo
-- en un entorno con datos reales debe exportarse la trazabilidad afectada.

begin;

revoke all on function public.anular_cobertura_manual_operativa(uuid, uuid, text) from public, anon, authenticated, service_role;
drop function if exists public.anular_cobertura_manual_operativa(uuid, uuid, text);

drop index if exists public.registros_asistencia_cobertura_origen_idx;

alter table public.registros_asistencia
  drop constraint if exists registros_asistencia_cobertura_anulacion_intervencion_fk,
  drop constraint if exists registros_asistencia_cobertura_anulada_horas_cero;

alter table public.supervisor_intervenciones
  drop column if exists cobertura_origen_intervencion_id;

alter table public.registros_asistencia
  drop column if exists cobertura_anulacion_intervencion_id,
  drop column if exists cobertura_intervencion_origen_id,
  drop column if exists cobertura_anulada_motivo,
  drop column if exists cobertura_anulada_por,
  drop column if exists cobertura_anulada_at,
  drop column if exists horas_liquidables_antes_anulacion;

commit;
