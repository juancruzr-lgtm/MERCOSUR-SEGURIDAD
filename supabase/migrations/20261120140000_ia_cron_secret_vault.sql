-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- IA: el secreto del cron sale de Supabase Vault, no de app_config
-- ============================================================================
--
-- ── Problema (verificado el 02/11/2026, sin leer el valor) ──────────────────
-- ia_disparar_analisis() lee el secreto del cron de IA de
-- app_config.ia_cron_secret, en texto plano. app_config tiene la política
-- «Autenticados leen configuración» (USING true): cualquier usuario con sesión
-- —incluidos los vigiladores— puede leer ese valor desde el navegador. El
-- secreto debe considerarse EXPUESTO y rotarse (pasos abajo).
-- Los demás crons (push, WhatsApp) ya leen push_cron_secret desde Vault.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
--  1. ia_disparar_analisis() lee primero vault.decrypted_secrets
--     (name = 'ia_cron_secret'); si no existe, cae a app_config (transición).
--     Mismo contrato: sin URL o sin secreto, o con IA apagada, no hace nada.
--  2. Política RESTRICTIVA de lectura en app_config: ningún usuario
--     autenticado ve claves con forma de secreto. El servidor (service_role) y
--     las funciones SECURITY DEFINER no pasan por RLS y siguen leyendo.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
-- No crea el secreto en Vault, no lo rota y no borra la fila de app_config:
-- eso es manual y en orden (docs/auditoria-2026-10/regla_validacion.md,
-- «Rotación del secreto del cron de IA»). Esta migración no lee ni escribe el
-- valor del secreto.
--
-- Base: definición VIVA de ia_disparar_analisis (02/11/2026).
-- Rollback: supabase/rollback/20261120140000_ia_cron_secret_vault_rollback.sql
-- ============================================================================

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
$fn$;

revoke all on function public.ia_disparar_analisis() from public;
revoke all on function public.ia_disparar_analisis() from anon;
revoke all on function public.ia_disparar_analisis() from authenticated;

-- Ningún usuario autenticado lee claves con forma de secreto. RESTRICTIVA: se
-- combina con AND con las permisivas existentes, no las reemplaza.
drop policy if exists app_config_sin_secretos on public.app_config;
create policy app_config_sin_secretos
  on public.app_config
  as restrictive
  for select
  to authenticated, anon
  using (key !~* '(secret|token|password|api_key)');

notify pgrst, 'reload schema';

commit;

-- ── Verificación (después de aplicar; ninguna consulta muestra el valor) ────
-- 1) ¿Hay secreto en Vault? (sólo el nombre)
--    select name, created_at from vault.secrets where name = 'ia_cron_secret';
-- 2) ¿El cron sigue respondiendo 200? (últimas respuestas de pg_net)
--    select id, status_code, created from net._http_response order by created desc limit 10;
-- 3) Un usuario autenticado ya no ve la clave (correr como authenticated):
--    select count(*) from public.app_config where key = 'ia_cron_secret';  -- esperado 0
