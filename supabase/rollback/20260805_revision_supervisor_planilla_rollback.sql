-- Rollback de 20260805150000_revision_supervisor_planilla.sql
--
-- ATENCIÓN: DROP TABLE destruye el historial de revisiones del supervisor.
-- Requiere autorización expresa. Las policies de OT-02 se restauran a la
-- versión previa (admin/supervisor activo sin alcance por zonas).

BEGIN;

DROP FUNCTION IF EXISTS public.revisar_primer_control(uuid, uuid, text, text, uuid);
DROP TABLE IF EXISTS public.revisiones_planilla;

DROP POLICY IF EXISTS aceptaciones_planilla_select ON public.aceptaciones_planilla;
CREATE POLICY aceptaciones_planilla_select
  ON public.aceptaciones_planilla FOR SELECT
  USING (
    empleado_id IN (SELECT u.id FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol IN ('admin', 'supervisor')
    )
  );

DROP POLICY IF EXISTS solicitudes_mod_planilla_select ON public.solicitudes_modificacion_planilla;
CREATE POLICY solicitudes_mod_planilla_select
  ON public.solicitudes_modificacion_planilla FOR SELECT
  USING (
    empleado_id IN (SELECT u.id FROM public.usuarios u WHERE u.auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.estado = 'activo' AND u.rol IN ('admin', 'supervisor')
    )
  );

DROP FUNCTION IF EXISTS public.turno_en_alcance_supervisor(uuid, uuid);

COMMIT;
