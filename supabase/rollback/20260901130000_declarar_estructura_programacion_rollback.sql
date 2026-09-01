-- Rollback de 20260901130000_declarar_estructura_programacion
--
-- Ejecutar SOLO si se decide revertir la declaración transaccional.
--
-- ATENCIÓN antes de restaurar el CHECK y el NOT NULL:
--   · si ya hay filas de auditoría con acciones de declaración, el CHECK
--     restringido no puede recrearse sin borrarlas o conservarlas aparte:
--       create table respaldo_serv_obj_auditoria_declarar_20260901 as
--         select * from public.servicios_objetivo_auditoria
--         where accion like 'declarar_%';
--       delete from public.servicios_objetivo_auditoria
--         where accion like 'declarar_%';
--   · el NOT NULL de puesto_id_nuevo solo puede restaurarse si no quedan
--     filas con ese campo en null.

DROP FUNCTION IF EXISTS public.declarar_estructura_programacion(uuid, jsonb, jsonb, jsonb, jsonb);

ALTER TABLE public.servicios_objetivo_auditoria
  DROP CONSTRAINT IF EXISTS servicios_objetivo_auditoria_accion_check;

ALTER TABLE public.servicios_objetivo_auditoria
  ADD CONSTRAINT servicios_objetivo_auditoria_accion_check
  CHECK (accion IN ('vincular_puesto'));

ALTER TABLE public.servicios_objetivo_auditoria
  ALTER COLUMN puesto_id_nuevo SET NOT NULL;
