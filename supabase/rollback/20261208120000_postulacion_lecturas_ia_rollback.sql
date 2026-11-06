-- Rollback de 20261208120000_postulacion_lecturas_ia.sql
-- OJO: borra el registro de lecturas con IA (modelo, tokens, costos). Exportarlo antes si tiene filas.
begin;
drop function if exists public.postulacion_registrar_lectura(uuid, text, text, integer, integer, numeric, text, jsonb, text[], text);
drop function if exists public.postulacion_preparar_lectura(uuid);
drop table if exists public.postulacion_lecturas_ia;
commit;
