-- PASO 4 · Tareas automáticas cada 10 minutos (mismo patrón y secreto que
-- whatsapp-ronda-vigilador). Ejecutar SÓLO después de:
--   - aplicar 20261217120000 y 20261218120000,
--   - desplegar el código con ENVIO_HABILITADO / HABILITADO = true,
--   - cargar WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE en Vercel,
--   - correr el ensayo en seco (ver la guía).
select cron.schedule('whatsapp-objetivo-sin-configurar', '*/10 * * * *', $$
  select net.http_get(
    url := 'https://mercosur-seguridad.vercel.app/api/whatsapp/objetivo-sin-configurar?enviar=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    timeout_milliseconds := 60000);
$$);
select cron.schedule('ronda-guiada-avisos', '3-59/10 * * * *', $$
  select net.http_get(
    url := 'https://mercosur-seguridad.vercel.app/api/push/ronda-guiada?enviar=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    timeout_milliseconds := 60000);
$$);
select jobname, schedule, active from cron.job where jobname in ('whatsapp-objetivo-sin-configurar', 'ronda-guiada-avisos');
