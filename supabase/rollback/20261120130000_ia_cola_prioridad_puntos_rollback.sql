-- Rollback de 20261120130000_ia_cola_prioridad_puntos.sql
--
-- Borra la función de cola, el índice y las dos claves de configuración. El
-- código desplegado cae solo a la consulta anterior (lib/ia/procesar.ts trata
-- la función ausente como «sin cola»), así que el rollback no rompe el cron;
-- vuelve el comportamiento anterior (más nuevas primero, con pérdidas).
-- Los análisis ya hechos no se tocan.

begin;

drop function if exists public.ia_evidencias_por_analizar(timestamptz, text[], integer, interval, integer);
drop index if exists public.idx_evidencias_tipo_fecha;
delete from public.app_config where key in ('ia_muestra_puntos_validados_por_dia', 'ia_cola_max_dias');

notify pgrst, 'reload schema';

commit;
