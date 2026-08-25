-- Rollback de 20260825180000 + 20260825180100.
--
-- ARCHIVO APARTE A PROPOSITO: no se pega junto a la migracion, porque un bloque
-- SQL se ejecuta entero y desharia lo que se acaba de aplicar.
--
-- NO borra ninguna fila. Las revisiones con decision 'SANEADO' que ya existan
-- quedan donde estan: son historial, y perderlas seria perder la unica prueba
-- de que ese cierre fue administrativo.
--
-- Por eso los checks NO se pueden volver a la version de dos valores mientras
-- haya filas SANEADO: primero habria que decidir que se hace con ellas, que es
-- una decision de negocio y no de esquema. El rollback solo saca la funcion.

drop function if exists public.ia_sanear_observaciones_previas(text, timestamptz, boolean);

-- Si ademas se quisiera revertir el esquema, hay que vaciar SANEADO primero.
-- Se deja escrito y comentado, no ejecutable de un pegado:
--
--   -- 1. ver que hay:
--   -- select count(*) from evidencia_analisis where revision_estado = 'SANEADO';
--   -- 2. devolverlas a pendiente (vuelven a la bandeja):
--   -- update evidencia_analisis
--   --    set revision_estado = 'PENDIENTE', revisado_por = null,
--   --        revisado_at = null, revision_comentario = null
--   --  where revision_estado = 'SANEADO';
--   -- 3. recien ahi:
--   -- alter table evidencia_analisis drop constraint evidencia_analisis_revision_estado_check;
--   -- alter table evidencia_analisis add constraint evidencia_analisis_revision_estado_check
--   --   check (revision_estado in ('PENDIENTE','CORRECTO','INCORRECTO'));

notify pgrst, 'reload schema';
