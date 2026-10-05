-- ROLLBACK de 20261005140000_afiliar_sindicato_permanente.sql
-- Elimina la función de afiliación automática de sindicato. No borra permanentes
-- ya creados por ella (son datos de liquidación; si se requiere, revisar a mano).
begin;
drop function if exists public.afiliar_sindicato_permanente(uuid[], text);
commit;
notify pgrst, 'reload schema';
