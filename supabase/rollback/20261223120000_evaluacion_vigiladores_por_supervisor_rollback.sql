-- Rollback de 20261223120000_evaluacion_vigiladores_por_supervisor.
-- OJO: borra las evaluaciones cargadas. Correr sólo si nadie cargó todavía o
-- después de exportarlas.

begin;

drop function if exists public.evaluacion_vigilador_guardar(uuid, integer, integer, integer, integer, integer, integer, integer, text, text, text);
drop function if exists public.evaluacion_vigiladores_mias();
drop function if exists public.evaluacion_vigiladores_de_zona(uuid);
drop table if exists public.evaluaciones_vigilador_supervisor;

notify pgrst, 'reload schema';

commit;
