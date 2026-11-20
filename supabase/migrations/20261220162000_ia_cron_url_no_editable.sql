-- La URL del cron de IA no se edita desde la app (F-07 / P-06).
--
-- APLICADA en producción el 20/11/2026 (verificada con consultas de catálogo y de datos). Basada en las definiciones VIVAS de producción leídas el
-- 20/11/2026 (pg_get_functiondef de ia_disparar_analisis y pg_policy de app_config).
--
-- Hoy: ia_disparar_analisis() (cron cada 5 min) hace net.http_post a
-- app_config.ia_cron_url con 'Authorization: Bearer <ia_cron_secret>'. La policy
-- app_config_config_update deja a puede_configurar_sistema_actual() (7 personas)
-- hacer UPDATE de cualquier clave, también ia_cron_url: apuntándola a un host propio
-- se recibe el secreto en 5 minutos.
--
-- Qué hace (no toca secretos ni Vault):
--  1. Restrictivas en app_config: con la sesión de un usuario no se puede crear,
--     cambiar (ni renombrar otra clave a) ni borrar la fila ia_cron_url. Se cambia
--     sólo con service_role / SQL de mantenimiento.
--  2. ia_disparar_analisis: mismo cuerpo vivo + un segundo freno: si la URL no es
--     https://mercosur-seguridad.vercel.app/... no se llama (y se deja un WARNING en
--     el log). Si algún día cambia el dominio, se cambia esta función por migración.
--
-- Rollback: supabase/rollback/20261220162000_ia_cron_url_no_editable_rollback.sql

drop policy if exists app_config_ia_cron_url_insert on public.app_config;
create policy app_config_ia_cron_url_insert on public.app_config
  as restrictive for insert to authenticated, anon
  with check (key <> 'ia_cron_url');

drop policy if exists app_config_ia_cron_url_update on public.app_config;
create policy app_config_ia_cron_url_update on public.app_config
  as restrictive for update to authenticated, anon
  using (key <> 'ia_cron_url')
  with check (key <> 'ia_cron_url');

drop policy if exists app_config_ia_cron_url_delete on public.app_config;
create policy app_config_ia_cron_url_delete on public.app_config
  as restrictive for delete to authenticated, anon
  using (key <> 'ia_cron_url');

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

  -- NUEVO (F-07): el secreto sólo viaja al dominio propio. Una URL cambiada en
  -- app_config (por quien sea) no recibe el Bearer.
  if coalesce(btrim(v_url), '') <> ''
     and v_url !~ '^https://mercosur-seguridad\.vercel\.app/' then
    raise warning 'ia_disparar_analisis: ia_cron_url fuera del dominio permitido; no se llama';
    return;
  end if;

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
