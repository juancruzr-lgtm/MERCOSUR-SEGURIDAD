-- Rollback de 20261203130000_facturacion_reagrupar_atomico: quita sólo la función.
-- No toca datos: las prefacturas descartadas y creadas por un reagrupado quedan como están (con su historial).
-- Sin la función, la app no reagrupa: informa el conflicto y deja las prefacturas como estaban.
begin;
drop function if exists public.fact_prefacturas_reagrupar(jsonb, jsonb);
commit;
