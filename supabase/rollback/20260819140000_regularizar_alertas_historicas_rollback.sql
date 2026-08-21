-- Rollback de 20260819140000_regularizar_alertas_historicas.sql
--
-- ARCHIVO APARTE A PROPOSITO: nunca va pegado a la migracion, porque un bloque
-- SQL en el editor se ejecuta entero y desharia lo que se acaba de aplicar.
--
-- Solo elimina la funcion de lote. NO revierte los cierres ya hechos: las
-- alertas regularizadas siguen en estado 'resuelta' con su intervencion, que es
-- justamente el historial que queriamos conservar. Revertir un cierre concreto
-- es una decision operativa, no un rollback de esquema.

drop function if exists public.regularizar_ronda_alertas_historicas(date, text, text[], uuid, boolean);

notify pgrst, 'reload schema';
