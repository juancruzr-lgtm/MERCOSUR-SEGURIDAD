-- Rollback de 20261208100000_facturacion_conceptos_fijos.
-- Sólo si no hay prefacturas emitidas con renglones de conceptos fijos (sus
-- renglones quedan en fact_prefacturas.lineas igual; esto sólo quita la tabla y
-- las funciones). Con conceptos cargados, la tabla se borra con sus datos: el
-- historial (fact_historial) conserva cada alta y cierre.
begin;
drop function if exists public.fact_concepto_fijo_cerrar(uuid, date, text);
drop function if exists public.fact_concepto_fijo_agregar(uuid, uuid, text, text, numeric, text, numeric, date, boolean, text);
drop table if exists public.fact_conceptos_fijos;
drop function if exists public.fact_conceptos_fijos_sin_solape();
commit;
notify pgrst, 'reload schema';
