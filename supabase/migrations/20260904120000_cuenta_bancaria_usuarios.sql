-- ============================================================================
-- USUARIOS · cuenta_bancaria — cuenta de acreditación de haberes
-- ============================================================================
-- La columna CUENTA del Resumen Guardia (plantilla de liquidación) estaba
-- vacía porque la app no tenía el dato: vivía solo en la planilla de sueldos.
-- Este campo la persiste como TEXTO —conserva ceros a la izquierda y admite
-- tanto número de cuenta como CBU de 22 dígitos— sin validar formato: es un
-- dato informativo del circuito de liquidación, no participa de cálculos ni
-- de pagos automáticos.
-- Se carga por saneamiento desde la planilla de sueldos (match por CUIL) y es
-- editable como cualquier dato del empleado.
-- ============================================================================

begin;

alter table public.usuarios
  add column if not exists cuenta_bancaria text;

comment on column public.usuarios.cuenta_bancaria is
  'Cuenta de acreditación de haberes (número de cuenta o CBU), texto para '
  'conservar ceros a la izquierda. Informativo: sin efecto en cálculos.';

notify pgrst, 'reload schema';

commit;
