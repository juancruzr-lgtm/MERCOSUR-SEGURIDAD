-- Rollback de 20260727120000_rondas_lectura_guardia.sql
-- Elimina exclusivamente la funcion de lectura para el vigilador.
-- No toca tablas, RLS ni grants de rondas_base / ronda_puntos.

begin;

drop function if exists public.obtener_rondas_guardia_actual();

notify pgrst, 'reload schema';

commit;
