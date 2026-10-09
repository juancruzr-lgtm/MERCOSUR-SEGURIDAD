-- Rollback de 20261009150000_legajo_historico.
--
-- Sirve sólo ANTES de importar documentos. Los documentos ya importados
-- (documentacion_documentos con origen 'historico') NO se tocan acá: siguen
-- en el legajo con su trazabilidad (repositorio_id, ruta y hash de origen).
-- No borra archivos de Storage ni de MEGA.

begin;

drop function if exists public.legajo_historico_indicios_de(uuid);
drop function if exists public.documentacion_importar_historico(uuid, uuid, text, jsonb);
drop function if exists public.legajo_historico_resolver(uuid, text, uuid, text, date, date, text, text, jsonb, boolean);
drop function if exists public.legajo_historico_buscar_persona(text);
drop function if exists public.legajo_historico_bandeja(text, integer);
drop function if exists public.legajo_historico_cargar_indicio(jsonb);
drop function if exists public.legajo_cargar_dato_planilla(jsonb);
drop function if exists public.legajo_historico_cargar_propuesta(jsonb);
drop function if exists public.legajo_historico_evento(uuid, text, jsonb);

drop table if exists public.legajo_historico_indicios;
drop table if exists public.legajo_historico_eventos;
drop table if exists public.legajo_historico_propuestas;

drop function if exists public.legajo_historico_proteger();
drop function if exists public.legajo_dni_normalizado(text);

notify pgrst, 'reload schema';

commit;
