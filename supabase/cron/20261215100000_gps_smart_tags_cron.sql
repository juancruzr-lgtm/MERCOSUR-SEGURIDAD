-- ═══════════════════════════════════════════════════════════════════════════
-- Disparador cada 10 min de /api/cron/gps-smart-tags.
-- PREPARADO, NO APLICADO. Aplicar sólo con autorización expresa de Gerencia y
-- después de que exista un proveedor habilitado (hoy sólo 'simulado').
-- Usa el mismo patrón que los otros crons (pg_net + secreto en Vault).
-- Para desactivarlo: select cron.unschedule('gps-smart-tags-10min');
-- ═══════════════════════════════════════════════════════════════════════════
select cron.schedule(
  'gps-smart-tags-10min',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := 'https://mercosur-seguridad.vercel.app/api/cron/gps-smart-tags',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
    timeout_milliseconds := 55000
  );
  $$
);
