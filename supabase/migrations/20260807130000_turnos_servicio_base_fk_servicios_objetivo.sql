-- Corrección de FK — turnos.servicio_base_id (Bloque E)
--
-- Hallazgo de la primera ejecución real de crear_turnos_programacion_parcial:
-- la FK turnos_servicio_base_id_fkey referenciaba servicios_base, una tabla
-- legacy VACÍA (0 filas). Por eso ningún turno pudo guardar nunca
-- servicio_base_id (0 turnos lo tienen) y la generación devolvió las 78
-- filas omitidas con violación de FK, sin crear nada (comportamiento por
-- fila correcto; la operación quedó auditada).
--
-- Toda la semántica vigente de programación (vista previa, deduplicación,
-- RPC, interfaz) usa servicios_objetivo. Se re-apunta la FK ahí.
--
-- Seguridad: 0 filas usan la columna → el cambio de constraint no valida ni
-- modifica ningún dato existente. No se tocan turnos históricos ni la tabla
-- servicios_base (queda como está). Reversible.

ALTER TABLE public.turnos
  DROP CONSTRAINT IF EXISTS turnos_servicio_base_id_fkey;

ALTER TABLE public.turnos
  ADD CONSTRAINT turnos_servicio_base_id_fkey
  FOREIGN KEY (servicio_base_id) REFERENCES public.servicios_objetivo(id)
  ON DELETE SET NULL;
