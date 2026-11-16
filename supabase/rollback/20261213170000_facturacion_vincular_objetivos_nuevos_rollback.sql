-- Rollback de 20261213170000_facturacion_vincular_objetivos_nuevos.sql
-- Saca el trigger y las funciones. Los vínculos que se crearon solos NO se borran (las anulaciones conservan
-- el registro): si hace falta deshacer uno, se anula desde Maestros. Para listarlos:
--   select * from public.fact_historial where accion = 'objetivo_vinculado_auto';
begin;
drop trigger if exists fact_objetivo_vincular_auto on public.objetivos;
drop function if exists public.fact_objetivo_vincular_auto();
drop function if exists public.fact_objetivo_contrato_sugerido(uuid);
drop function if exists public.fact_cliente_clave(text);
commit;
