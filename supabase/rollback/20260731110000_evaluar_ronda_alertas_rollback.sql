-- ROLLBACK de 20260731110000: elimina el evaluador de alertas de rondas.
begin;
drop function if exists public.evaluar_ronda_alertas();
notify pgrst, 'reload schema';
commit;
