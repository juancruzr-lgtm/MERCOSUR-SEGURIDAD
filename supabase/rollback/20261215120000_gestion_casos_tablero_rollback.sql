-- Rollback de 20261215120000_gestion_casos_tablero (SIN APLICAR).
-- Sólo borra lo que creó esa migración. No toca ninguna tabla operativa.
-- ATENCIÓN: si la migración llegó a usarse, borra el historial de casos y
-- comunicaciones. Exportarlo antes (select * de las cuatro tablas).
begin;
drop function if exists public.gestion_regla_decidir(text, text, text);
drop function if exists public.gestion_caso_accion(uuid, uuid, text, integer, text, uuid, text, uuid, boolean);
drop table if exists public.gestion_comunicaciones;
drop table if exists public.gestion_caso_eventos;
drop table if exists public.gestion_casos;
drop table if exists public.gestion_reglas;
commit;
