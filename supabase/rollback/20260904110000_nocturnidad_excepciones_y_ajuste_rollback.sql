-- ============================================================================
-- ROLLBACK · 20260904110000_nocturnidad_excepciones_y_ajuste
-- ============================================================================
-- Deshace la tabla de excepciones y el tipo de ajuste. Las filas de auditoría
-- ya escritas en objetivos_auditoria se CONSERVAN. OJO: si existen novedades
-- con tipo 'ajuste_nocturnidad', el CHECK restaurado fallaría — el rollback
-- las marca explícitamente antes (conservando el registro como 'rechazada'
-- con observación), nunca las borra.
-- ============================================================================

begin;

drop trigger if exists trg_nocturnidad_excepcion_zz_auditoria
  on public.nocturnidad_empleado_objetivo;

drop function if exists public.nocturnidad_excepcion_auditar();

drop table if exists public.nocturnidad_empleado_objetivo;

-- Neutralizar ajustes existentes antes de restaurar el CHECK original.
update public.novedades_laborales
set estado = 'rechazada',
    observacion = coalesce(observacion || ' · ', '')
      || '[rollback 20260904110000: tipo ajuste_nocturnidad retirado del sistema]',
    tipo = 'otra'
where tipo = 'ajuste_nocturnidad';

alter table public.novedades_laborales
  drop constraint if exists novedades_laborales_ajuste_nocturnidad_horas;

alter table public.novedades_laborales
  drop constraint if exists novedades_laborales_tipo_check;

alter table public.novedades_laborales
  add constraint novedades_laborales_tipo_check
  check (tipo in (
    'parte_medico',
    'accidente',
    'licencia',
    'vacaciones',
    'falta_justificada',
    'falta_injustificada',
    'dia_estudio',
    'suspension',
    'franco',
    'otra'
  ));

notify pgrst, 'reload schema';

commit;
