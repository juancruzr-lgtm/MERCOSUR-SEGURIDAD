-- Rollback de 20260824170000_cerrar_ronda_alertas_pendientes.sql
-- Archivo aparte a proposito: un bloque pegado al editor se ejecuta entero.
--
-- Borra la funcion nueva y restaura la anterior NO: la anterior quedo obsoleta
-- al cambiar la regla operativa. Si hiciera falta volver atras, se reaplica la
-- migracion 20260819140000. Los cierres ya hechos NO se revierten: las alertas
-- siguen resueltas con su intervencion, que es el historial que se queria
-- conservar.

drop function if exists public.cerrar_ronda_alertas_pendientes(date, date, text, text[], uuid, boolean);

notify pgrst, 'reload schema';
