-- Rollback de 20261010120000: sólo funciones (no hay tablas ni datos propios).
-- Las propuestas que se hayan cargado con legajo_historico_cargar_desde_indice
-- NO se borran: se descartan desde la bandeja (lote 'indice-AAAA-MM').
begin;
drop function if exists public.legajo_historico_cargar_desde_indice(integer, boolean);
drop function if exists public.legajo_historico_indice_resumen();
drop function if exists public.legajo_historico_indice_analisis();
drop function if exists public.legajo_historico_categoria_de_texto(text);
drop function if exists public.legajo_historico_normalizar(text);
notify pgrst, 'reload schema';
commit;
