-- Rollback de 20261120140000_ia_cron_secret_vault.sql
--
-- Vuelve ia_disparar_analisis() a la definición viva del 02/11/2026 (secreto
-- sólo desde app_config) y quita la política restrictiva. OJO: si ya se vació
-- app_config.ia_cron_secret (paso 6 de la rotación), después de este rollback
-- el cron de IA deja de llamar hasta volver a cargar el secreto en app_config.
-- No borra el secreto de Vault.

begin;

create or replace function public.ia_disparar_analisis()
returns void
language plpgsql
security definer
set search_path = public, extensions, net, pg_catalog
as $fn$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from public.app_config where key = 'ia_cron_url';
  select value into v_secret from public.app_config where key = 'ia_cron_secret';

  -- Sin configurar = no hace nada. Es el estado en el que queda esta migración.
  if coalesce(btrim(v_url), '') = '' or coalesce(btrim(v_secret), '') = '' then
    return;
  end if;

  -- Segundo freno: aunque la URL esté puesta, si el interruptor general está
  -- apagado no se gasta ni una llamada.
  if coalesce((select value from public.app_config where key = 'ia_analisis_enabled'), 'false') <> 'true' then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$fn$;

revoke all on function public.ia_disparar_analisis() from public;

drop policy if exists app_config_sin_secretos on public.app_config;

notify pgrst, 'reload schema';

commit;
