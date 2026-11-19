-- Rollback de 20261218120000. Las rondas creadas por el flujo guiado NO se
-- borran (quedan en rondas_base con su historial); sólo se quita el flujo.
begin;
drop function if exists public.ronda_guiada_activar_vencidas();
drop function if exists public.ronda_guiada_decidir(uuid, text, text);
drop function if exists public.ronda_guiada_marcar_punto(uuid, integer, numeric, numeric, numeric);
drop function if exists public.ronda_guiada_mi_pendiente();
drop function if exists public.ronda_guiada_solicitar(uuid, uuid);
drop function if exists public.ronda_guiada_distancia(numeric, numeric, numeric, numeric);
drop table if exists public.ronda_guiada;
commit;
