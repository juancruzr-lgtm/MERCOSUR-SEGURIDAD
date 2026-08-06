-- Rollback de 20260807130000_turnos_servicio_base_fk_servicios_objetivo.sql
-- Restaura la FK original hacia la tabla legacy servicios_base.
-- ATENCIÓN: si para entonces existen turnos con servicio_base_id apuntando a
-- servicios_objetivo, este rollback fallará por violación de FK; habría que
-- poner esos servicio_base_id en NULL primero (decisión administrativa).

BEGIN;

ALTER TABLE public.turnos
  DROP CONSTRAINT IF EXISTS turnos_servicio_base_id_fkey;

ALTER TABLE public.turnos
  ADD CONSTRAINT turnos_servicio_base_id_fkey
  FOREIGN KEY (servicio_base_id) REFERENCES public.servicios_base(id)
  ON DELETE SET NULL;

COMMIT;
