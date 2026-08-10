-- Ejecución automática de evaluar_ronda_alertas()
--
-- CAUSA DEL PROBLEMA
-- Las alertas 'no_iniciada' no se derivan al consultar: son filas que crea
-- evaluar_ronda_alertas(). Esa función solo se invocaba desde
-- /api/push/cron, y NO existe ningún programador que llame a esa ruta: no hay
-- "crons" en vercel.json, ni pg_cron instalado, ni workflows de GitHub. En la
-- práctica no corría nunca, así que una ronda que debía empezar y no empezó no
-- generaba alerta hasta que alguien abría la aplicación.
--
-- POR QUÉ NO SE ACTIVA /api/push/cron
-- Esa ruta hace mucho más que evaluar rondas: cierra turnos abiertos
-- (cerrar_turnos_abiertos) y ENVÍA NOTIFICACIONES PUSH reales a supervisores y
-- vigiladores (supervisiones vencidas, alertas de rondas, recordatorios 15'
-- antes). Programarla entera dispararía efectos no solicitados. Por eso la
-- evaluación se programa por separado, dentro de la base.
--
-- SOLUCIÓN
-- pg_cron ejecuta la MISMA función autoritativa dentro de PostgreSQL, cada 10
-- minutos, sin pasar por la aplicación ni por HTTP. Funciona aunque ningún
-- supervisor tenga abierta la app, que es justamente el requisito. No envía
-- ninguna notificación: solo evalúa y persiste alertas.
--
-- Cada 10 minutos contra una tolerancia por defecto de 15
-- (ronda_alerta_tolerancia_min en app_config): la alerta aparece dentro de los
-- 10 minutos de vencida la tolerancia.
--
-- SEGURIDAD DE LA REPETICIÓN
-- evaluar_ronda_alertas es idempotente: ronda_alertas tiene un único por
-- (ronda_base_id, turno_id, ventana_inicio, tipo) y el insert hace
-- ON CONFLICT DO UPDATE ... WHERE estado = 'pendiente'. Repetirla no duplica
-- ocurrencias ni reabre alertas ya resueltas.
--
-- Reversible: select cron.unschedule('evaluar-ronda-alertas');

create extension if not exists pg_cron;

-- Reprogramar de cero: unschedule previo para que la migración sea idempotente
-- y no acumule jobs duplicados si se corre más de una vez.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'evaluar-ronda-alertas') then
    perform cron.unschedule('evaluar-ronda-alertas');
  end if;
end $$;

select cron.schedule(
  'evaluar-ronda-alertas',
  '*/10 * * * *',
  $cron$ select public.evaluar_ronda_alertas(); $cron$
);
