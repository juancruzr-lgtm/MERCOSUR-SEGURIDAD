-- ROLLBACK · 20260818130000_cron_push_desfasado
-- Vuelve el job push-notificaciones a */10 con timeout 25000 (estado previo).

select cron.unschedule('push-notificaciones');

select cron.schedule(
  'push-notificaciones',
  '*/10 * * * *',
  $$
    select net.http_get(
      url := 'https://mercosur-seguridad.vercel.app/api/push/notificaciones',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
      ),
      timeout_milliseconds := 25000
    );
  $$
);
