-- ============================================================================
-- CRON push-notificaciones: desfasar 2 minutos respecto de evaluar-ronda-alertas
-- y alinear el timeout de pg_net con la duración real del endpoint.
-- ============================================================================
--
-- Verificado en producción el 18/08/2026 (cron.job_run_details):
--   evaluar-ronda-alertas  13:20:00.252 → 13:20:00.380
--   push-notificaciones    13:20:00.256 → 13:20:00.276  (sólo encola el HTTP)
--
-- Los dos jobs corren en el MISMO segundo. Hoy la carrera la gana el
-- evaluador por milisegundos —la función de Vercel arranca ~400 ms después
-- de encolarse, y para entonces la alerta ya está insertada— y las push de
-- `ronda no iniciada` salen 6-8 s después de crearse la alerta. Pero es
-- suerte de latencia, no diseño: un evaluador que tarde 1 s más un día
-- (más rondas, más pausas que evaluar) deja la alerta fuera de ese ciclo y
-- la push llega 10 minutos tarde. Correr el push en :02, :12, … lo hace
-- determinístico sin tocar la lógica de rondas ni las ventanas.
--
-- timeout_milliseconds pasa de 25000 a 60000: el endpoint tiene
-- maxDuration = 60 (PR #33). Con 25 s, un ciclo largo quedaba como
-- "timeout" en net._http_response aunque la función siguiera y terminara
-- bien: falso negativo de observabilidad.
--
-- El secreto sigue saliendo del Vault, igual que antes. Reversible con el
-- rollback (vuelve a */10 y 25000).
-- ============================================================================

select cron.unschedule('push-notificaciones');

select cron.schedule(
  'push-notificaciones',
  '2,12,22,32,42,52 * * * *',
  $$
    select net.http_get(
      url := 'https://mercosur-seguridad.vercel.app/api/push/notificaciones',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $$
);
