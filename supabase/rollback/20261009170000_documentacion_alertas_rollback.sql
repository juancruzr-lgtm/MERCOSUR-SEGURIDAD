-- Rollback de 20261009170000_documentacion_alertas.
-- Si la tarea de pg_cron se había aplicado, quitarla primero:
--   select cron.unschedule('documentacion-alertas');

begin;

drop function if exists public.documentacion_alerta_vista(bigint);
drop function if exists public.documentacion_mis_alertas();
drop function if exists public.documentacion_alertas_generar();
drop function if exists public.documentacion_vencimientos(integer);
drop function if exists public.documentacion_alertas_configurar(jsonb);

drop table if exists public.documentacion_alertas;
drop table if exists public.documentacion_alertas_config_historial;
drop table if exists public.documentacion_alertas_config;

drop function if exists public.documentacion_alertas_proteger();

notify pgrst, 'reload schema';

commit;
