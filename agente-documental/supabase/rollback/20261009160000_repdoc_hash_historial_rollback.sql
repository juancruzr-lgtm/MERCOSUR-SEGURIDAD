-- Rollback de 20261009160000_repdoc_hash_historial.
-- Quita el trigger y el historial. El índice (repositorio_documental) no se toca.

begin;

drop trigger if exists trg_repdoc_registrar_hash on public.repositorio_documental;
drop function if exists public.repdoc_registrar_hash();
drop table if exists public.repositorio_documental_hash_historial;
drop function if exists public.repdoc_hash_historial_inmutable();

commit;
