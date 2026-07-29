-- ROLLBACK de 20260731100000: elimina las tablas de alertas de rondas.
-- Ejecutar DESPUÉS del rollback de A2/cierre (que quita la referencia).
begin;
drop table if exists public.ronda_alerta_intervenciones;
drop table if exists public.ronda_alertas;
notify pgrst, 'reload schema';
commit;
