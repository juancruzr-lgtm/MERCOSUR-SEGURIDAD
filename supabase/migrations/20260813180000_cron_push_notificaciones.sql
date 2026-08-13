-- Disparador de las notificaciones push
--
-- APLICADA EN PRODUCCIÓN el 13/08/2026.
--
-- Apunta a la URL de producción, así que mientras este PR no esté fusionado el
-- job golpea un 404 y no envía nada. Al fusionar, la primera corrida sale sola
-- dentro de los 10 minutos siguientes: fusionar ES el encendido.
--
-- Antes de fusionar se sembraron 222 filas en notificaciones_enviadas —las
-- alertas de ronda pendientes por cada supervisor de la zona— para que el
-- histórico quede marcado como ya avisado y sólo se notifique de acá en
-- adelante. Sin eso, la primera corrida mandaba 148 avisos de golpe, 74 de
-- ellos a una sola persona.
--
-- POR QUÉ NO VERCEL CRON
-- El proyecto está en plan Hobby, donde los cron jobs se ejecutan una vez por
-- día. Los avisos de ronda salen 15 minutos antes de la ventana y el de egreso
-- entre 5 y 20 minutos después del fin del turno: hace falta una frecuencia de
-- 10 minutos. Hobby no llega.
--
-- QUÉ SE USA EN CAMBIO
-- pg_cron —ya instalado y corriendo evaluar_ronda_alertas()— más pg_net, que
-- ya está instalada en este proyecto (verificado: extname='pg_net' presente).
--
-- QUÉ LLAMA
-- /api/push/notificaciones, que es notifications-only: no cierra turnos, no
-- modifica registros_asistencia, no recalcula horas liquidables y no llama a
-- evaluar_ronda_alertas(). Esa última ya corre por su cuenta cada 10 minutos y
-- es la única fuente de ronda_alertas; acá solo se leen.
--
-- NO llama a /api/push/cron, que sí ejecuta cerrar_turnos_abiertos().
--
-- EL SECRETO
-- Este endpoint NO usa CRON_SECRET. Tiene llave propia, push_cron_secret, para
-- que quien tenga la de /api/push/cron —la que sí cierra turnos— no pueda
-- disparar ésta, ni al revés.
--
-- El valor no se escribe en esta migración ni en ningún commit. Vive en dos
-- lugares, con el mismo valor:
--
--   · variables de entorno de Vercel, como push_cron_secret;
--   · vault de Supabase, bajo el nombre push_cron_secret.
--
-- Se guarda a mano, una vez:
--
--   select vault.create_secret('EL_VALOR_REAL', 'push_cron_secret',
--                              'Bearer de /api/push/notificaciones');
--
-- Desde acá se lee por nombre, nunca por valor.
--
-- Reversible: select cron.unschedule('push-notificaciones');

begin;

create extension if not exists pg_net;

-- Reprogramar de cero para que la migración sea idempotente.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-notificaciones') then
    perform cron.unschedule('push-notificaciones');
  end if;
end $$;

-- Cada 10 minutos. La deduplicación por (usuario, turno, tipo) en
-- notificaciones_enviadas hace que repetir la llamada sea inofensivo: una
-- corrida de más no manda nada dos veces.
select cron.schedule(
  'push-notificaciones',
  '*/10 * * * *',
  $cron$
    select net.http_get(
      url     := 'https://mercosur-seguridad.vercel.app/api/push/notificaciones',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret
                        from vault.decrypted_secrets
                       where name = 'push_cron_secret')
      ),
      timeout_milliseconds := 25000
    );
  $cron$
);

commit;

-- ── Verificación posterior ───────────────────────────────────────────────────
--
-- El job quedó programado:
--   select jobname, schedule, active from cron.job where jobname = 'push-notificaciones';
--
-- Corrió y con qué resultado:
--   select d.status, d.start_time, d.return_message
--     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
--    where j.jobname = 'push-notificaciones'
--    order by d.start_time desc limit 5;
--
-- Qué respondió el endpoint (pg_net guarda la respuesta):
--   select id, status_code, content from net._http_response order by id desc limit 5;
--
-- Qué se envió realmente:
--   select tipo, count(*), max(created_at)
--     from public.notificaciones_enviadas
--    where created_at > now() - interval '1 hour'
--    group by tipo order by 2 desc;
