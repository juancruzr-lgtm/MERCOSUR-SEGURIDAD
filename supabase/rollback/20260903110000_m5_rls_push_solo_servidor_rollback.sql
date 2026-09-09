-- ============================================================================
-- ROLLBACK de M5 — Restituir el acceso laxo a las tablas de push
-- ============================================================================
--
-- Revierte: supabase/migrations/20260903110000_m5_rls_push_solo_servidor.sql
--
-- ATENCIÓN: restituye una configuración INSEGURA (cualquier autenticado puede
-- leer y borrar las suscripciones push de todos). Usar sólo si M5 rompió un
-- flujo de producción. Como todo el código pasa por /api con service_role,
-- una rotura indicaría un consumidor no identificado: registrarlo antes de
-- reintentar. Preferir siempre la salida guardada de la sección PRE.
-- Los nombres recreados son los originales de 20260619_push_notifications.sql.
-- ============================================================================

begin;

grant all on table public.push_subscriptions to authenticated;
grant all on table public.notificaciones_enviadas to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'push_subscriptions'
       and policyname = 'Admin acceso total push subscriptions'
  ) then
    create policy "Admin acceso total push subscriptions"
      on public.push_subscriptions for all using (true);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'notificaciones_enviadas'
       and policyname = 'Admin acceso total notificaciones enviadas'
  ) then
    create policy "Admin acceso total notificaciones enviadas"
      on public.notificaciones_enviadas for all using (true);
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- Verificación del rollback (debe devolver 2 filas):
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and tablename in ('push_subscriptions', 'notificaciones_enviadas')
--  order by tablename;
