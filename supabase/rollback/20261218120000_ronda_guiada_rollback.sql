-- Rollback de 20261218120000. Las rondas y protocolos creados por el flujo NO
-- se borran (quedan en rondas_base / protocolo_versiones con su historial);
-- sólo se quita el flujo. frecuencia_ronda_minutos se borra: anotar los
-- valores cargados antes de volver atrás.
begin;
drop function if exists public.protocolo_guiado_devolver(uuid, text);
drop function if exists public.protocolo_guiado_enviar(uuid, text, text);
drop function if exists public.ronda_guiada_desactivar(uuid, text);
drop function if exists public.ronda_guiada_reportar_problema(uuid, text, text);
drop function if exists public.ronda_guiada_marcar_punto(uuid, integer, numeric, numeric, numeric, timestamptz);
drop function if exists public.ronda_guiada_mi_pendiente();
drop function if exists public.ronda_guiada_solicitar(uuid, uuid);
drop function if exists public.ronda_guiada_corresponde(uuid);
drop function if exists public.ronda_guiada_mi_turno(uuid);
drop function if exists public.ronda_guiada_distancia(numeric, numeric, numeric, numeric);
drop table if exists public.ronda_guiada_eventos;
drop function if exists public.ronda_guiada_eventos_inmutables();
drop table if exists public.ronda_guiada;
drop table if exists public.ronda_guiada_config;
alter table public.objetivos drop column if exists frecuencia_ronda_minutos;
commit;
