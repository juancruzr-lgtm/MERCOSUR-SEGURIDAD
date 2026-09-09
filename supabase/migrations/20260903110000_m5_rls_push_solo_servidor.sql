-- ============================================================================
-- M5 — RLS: push_subscriptions y notificaciones_enviadas son sólo del servidor
-- ============================================================================
--
-- Continúa el saneamiento M4..M10 anunciado por M1.
--
-- MOTIVO
-- Ambas tablas conservan la política "Admin acceso total ..." FOR ALL
-- USING (true) creada en 20260619_push_notifications.sql. La revisión del
-- repositorio del 2026-09-03 confirma que el navegador NUNCA las toca:
--   * el alta de suscripción va por fetch a /api/push/subscribe
--     (lib/push-client.ts:144) y el servidor escribe con service_role
--     (app/api/push/subscribe/route.ts:51);
--   * el estado se consulta por /api/push/estado (lib/push-client.ts:220);
--   * todos los demás accesos están en app/api/_lib/push-notificaciones.ts y
--     rutas /api/push/*, siempre con getSupabaseAdmin() (service_role).
-- Con la política actual, cualquier autenticado puede leer los endpoints y
-- claves de suscripción push de todos los usuarios, o borrarlos.
--
-- QUÉ HACE: elimina toda política laxa de las dos tablas (barrido dinámico,
-- por si producción tiene nombres divergentes), no crea reemplazos y revoca
-- todos los privilegios de anon y authenticated.
--
-- QUÉ NO TOCA: service_role (las rutas /api/push/* siguen igual); pg_cron
-- (corre las rutas vía HTTP con push_cron_secret, del lado del servidor).
--
-- ANTES DE EJECUTAR: correr y guardar la sección PRE de
-- supabase/verificacion/20260903110000_m5_rls_push_solo_servidor_pre_post.sql
--
-- ROLLBACK: supabase/rollback/20260903110000_m5_rls_push_solo_servidor_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['push_subscriptions', 'notificaciones_enviadas']
  loop
    execute format('alter table public.%I enable row level security', t);

    for p in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = t
         and (qual = 'true' or (qual is null and with_check = 'true'))
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
      raise notice 'M5: eliminada la política laxa %.%', t, p.policyname;
    end loop;

    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
