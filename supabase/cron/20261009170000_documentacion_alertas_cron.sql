-- Tarea diaria de alertas de documentación del legajo.
--
-- NO APLICAR hasta que Gerencia prenda las alertas en Documentación →
-- Vencimientos. Aun aplicada, si el interruptor está apagado el endpoint no
-- hace nada. No manda push, WhatsApp ni mails: sólo registra las alertas.
--
-- Misma llave que el resto de los crons: push_cron_secret (vault).
-- Para quitarla: select cron.unschedule('documentacion-alertas');

select cron.schedule(
  'documentacion-alertas',
  '0 11 * * *',   -- 08:00 hora de Argentina
  $cron$
    select net.http_get(
      url     := 'https://mercosur-seguridad.vercel.app/api/cron/documentacion-alertas',
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
