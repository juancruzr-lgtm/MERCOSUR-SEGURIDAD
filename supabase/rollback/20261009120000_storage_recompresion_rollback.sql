-- Rollback de 20261009120000_storage_recompresion.
-- ATENCIÓN: si ya se recomprimieron fotos, ANTES de esto hay que revertirlas
-- (scripts/recomprimir-historico.mjs revertir --lote <id>) o exportar
-- storage_recompresion: es el único registro de qué archivo se reemplazó y
-- dónde está su original. El bucket respaldo-recompresion NO se borra acá.
begin;
drop function if exists public.storage_recompresion_candidatos(bigint, integer);
drop function if exists public.storage_recompresion_aprobar(uuid);
drop table if exists public.storage_recompresion;
drop table if exists public.storage_recompresion_lote;
drop function if exists public.storage_recompresion_proteger();
drop function if exists public.storage_recompresion_lote_proteger();
notify pgrst, 'reload schema';
commit;
