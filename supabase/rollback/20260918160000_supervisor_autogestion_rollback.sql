-- ROLLBACK de 20260918160000_supervisor_autogestion_operativa.sql
-- Elimina las RPCs de autogestión operativa. Los supervisores vuelven a depender
-- del flujo de solicitud + aprobación (las RPCs reutilizadas siguen existiendo).
begin;
drop function if exists public.autoservicio_solicitud_personal_operativo(text, uuid, jsonb);
drop function if exists public.dar_baja_objetivo_operativo(uuid);
commit;
notify pgrst, 'reload schema';
