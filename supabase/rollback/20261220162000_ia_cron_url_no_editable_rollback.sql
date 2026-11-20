-- Rollback 20261220162000_ia_cron_url_no_editable: vuelve EXACTAMENTE a la definición
-- viva de ia_disparar_analisis leída el 20/11/2026 y quita las restrictivas nuevas.
-- Correr como archivo aparte, nunca junto a la migración.

drop policy if exists app_config_ia_cron_url_insert on public.app_config;
drop policy if exists app_config_ia_cron_url_update on public.app_config;
drop policy if exists app_config_ia_cron_url_delete on public.app_config;

CREATE OR REPLACE FUNCTION public.ia_disparar_analisis()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net', 'pg_catalog'
AS $function$
declare
  v_url    text;
  v_secret text;
begin
  v_url := (select value from public.app_config where key = 'ia_cron_url');

  -- Vault primero. Si el esquema vault no está disponible, se sigue con la
  -- transición en vez de romper el cron.
  begin
    v_secret := (select ds.decrypted_secret
                   from vault.decrypted_secrets ds
                  where ds.name = 'ia_cron_secret'
                  order by ds.created_at desc nulls last
                  limit 1);
  exception when others then
    v_secret := null;
  end;

  -- Transición: mientras el secreto no esté en Vault se usa el de app_config.
  -- Cuando el Vault esté cargado y verificado, la fila de app_config se vacía
  -- (paso 6 de la rotación) y esta rama deja de usarse.
  if coalesce(btrim(v_secret), '') = '' then
    v_secret := (select value from public.app_config where key = 'ia_cron_secret');
  end if;

  -- Sin configurar = no hace nada.
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
$function$;
