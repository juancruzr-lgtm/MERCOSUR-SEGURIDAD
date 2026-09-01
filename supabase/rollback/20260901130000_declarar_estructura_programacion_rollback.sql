-- Rollback de 20260901130000_declarar_estructura_programacion
--
-- Ejecutar SOLO si se decide revertir la declaración transaccional.
-- Corre entero en una transacción: si cualquier paso falla, no queda nada
-- a medias.
--
-- La migración amplió el CHECK de accion y quitó el NOT NULL de
-- puesto_id_nuevo en servicios_objetivo_auditoria. Restaurar ese esquema
-- viejo es incompatible con las filas de auditoría 'declarar_%'. Este
-- rollback NO las borra en silencio ni depende de un paso manual previo:
--
--   1) si existen filas 'declarar_%', las ARCHIVA completas en
--      servicios_objetivo_auditoria_respaldo_declarar (se crea acá mismo,
--      sin acceso para anon/authenticated) y recién después las quita de
--      la tabla viva, informando cuántas se archivaron;
--   2) si después de archivar quedara alguna fila incompatible con el
--      esquema viejo (accion desconocida o puesto_id_nuevo en null), el
--      rollback SE FRENA con un error explícito antes de tocar el esquema;
--   3) recién entonces borra la función y restaura el CHECK y el NOT NULL.
--
-- El respaldo NO se borra nunca desde acá: eliminarlo es una decisión
-- aparte, cuando la auditoría archivada ya no haga falta.

DO $ROLLBACK$
DECLARE
  v_declarar integer;
  v_incompatibles integer;
BEGIN
  -- 1) Archivar la auditoría de declaración sin destruir información.
  SELECT count(*) INTO v_declarar
  FROM public.servicios_objetivo_auditoria
  WHERE accion LIKE 'declarar_%';

  IF v_declarar > 0 THEN
    CREATE TABLE IF NOT EXISTS public.servicios_objetivo_auditoria_respaldo_declarar
      (LIKE public.servicios_objetivo_auditoria INCLUDING DEFAULTS);
    REVOKE ALL ON public.servicios_objetivo_auditoria_respaldo_declarar
      FROM public, anon, authenticated;

    INSERT INTO public.servicios_objetivo_auditoria_respaldo_declarar
    SELECT * FROM public.servicios_objetivo_auditoria
    WHERE accion LIKE 'declarar_%';

    DELETE FROM public.servicios_objetivo_auditoria
    WHERE accion LIKE 'declarar_%';

    RAISE NOTICE 'Rollback: % fila(s) de auditoria de declaracion archivadas en servicios_objetivo_auditoria_respaldo_declarar.', v_declarar;
  ELSE
    RAISE NOTICE 'Rollback: no habia auditoria de declaracion para archivar.';
  END IF;

  -- 2) Nada incompatible con el esquema viejo puede quedar en la tabla viva.
  SELECT count(*) INTO v_incompatibles
  FROM public.servicios_objetivo_auditoria
  WHERE accion <> 'vincular_puesto' OR puesto_id_nuevo IS NULL;

  IF v_incompatibles > 0 THEN
    RAISE EXCEPTION 'Rollback FRENADO: quedan % fila(s) incompatibles con el esquema viejo (accion distinta de vincular_puesto o puesto_id_nuevo null). Nada fue modificado. Revisar esas filas antes de reintentar.', v_incompatibles;
  END IF;
END;
$ROLLBACK$;

-- 3) Revertir función y esquema (solo se llega acá con la tabla viva limpia).
DROP FUNCTION IF EXISTS public.declarar_estructura_programacion(uuid, jsonb, jsonb, jsonb, jsonb);

ALTER TABLE public.servicios_objetivo_auditoria
  DROP CONSTRAINT IF EXISTS servicios_objetivo_auditoria_accion_check;

ALTER TABLE public.servicios_objetivo_auditoria
  ADD CONSTRAINT servicios_objetivo_auditoria_accion_check
  CHECK (accion IN ('vincular_puesto'));

ALTER TABLE public.servicios_objetivo_auditoria
  ALTER COLUMN puesto_id_nuevo SET NOT NULL;
