-- Supervisiones: sin edición ni borrado directo por PostgREST (F-08 / P-07, ex SEG-10).
--
-- APLICADA en producción el 20/11/2026 (verificada con consultas de catálogo y de datos). Basada en las definiciones VIVAS de producción leídas el
-- 20/11/2026 (pg_policy / grants, sólo lectura), no en el repo.
--
-- Hoy: la policy `supervisiones_alcance` es FOR ALL y `authenticated` tiene UPDATE,
-- DELETE y TRUNCATE. Un supervisor puede reescribir o borrar supervisiones de su zona
-- (también las de otros supervisores) y el DELETE se lleva en cascada
-- `supervision_respuestas` y `supervision_fotos`.
--
-- Cómo escribe la app (verificado en el código el 20/11):
--  · Alta: /api/save-supervision (service_role) inserta la supervisión y sus respuestas.
--  · Fotos: /api/upload-supervision-photo (service_role) inserta en supervision_fotos.
--  · components/supervisor/SupervisorMobile.tsx hace, con la sesión del supervisor:
--      - UPDATE { estado } de la supervisión RECIÉN creada, si el estado final
--        (p. ej. 'incompleta' porque no subió la foto obligatoria) difiere del
--        preliminar → se conserva, acotado (ver abajo);
--      - DELETE de la supervisión recién creada si algo falla después del alta
--        (limpieza) → deja de poder hacerse: la supervisión queda guardada con su
--        estado preliminar. Es preferible (no se pierde evidencia) y el cliente no
--        mira el error de ese DELETE (no rompe la pantalla).
--  · Ningún otro UPDATE/DELETE de supervisiones, respuestas ni fotos desde el navegador.
--
-- Después de esta migración, para `authenticated`:
--  · supervisiones: SELECT e INSERT con la misma regla de alcance de hoy; UPDATE sólo
--    de la columna `estado`, sólo de las PROPIAS y sólo en las 2 horas siguientes al
--    alta; sin DELETE ni TRUNCATE.
--  · supervision_respuestas / supervision_fotos: sólo SELECT (alcance de hoy). Las
--    escribe el servidor (service_role, no lo afecta RLS ni estos grants).
--  · service_role sin cambios (el rollback del alta en save-supervision sigue andando).
--
-- Rollback: supabase/rollback/20261220160000_supervisiones_sin_edicion_directa_rollback.sql

-- supervisiones -----------------------------------------------------------------
drop policy if exists supervisiones_alcance on public.supervisiones;

create policy supervisiones_select_alcance on public.supervisiones
  as permissive for select to authenticated
  using ((alcanza_objetivo_actual(objetivo_id) OR (es_operador_actual() AND (supervisor_id IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.auth_user_id = auth.uid()))))));

create policy supervisiones_insert_alcance on public.supervisiones
  as permissive for insert to authenticated
  with check ((alcanza_objetivo_actual(objetivo_id) OR (es_operador_actual() AND (supervisor_id IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.auth_user_id = auth.uid()))))));

-- Compatibilidad con SupervisorMobile: fijar el estado final de la supervisión que el
-- mismo supervisor acaba de crear. Nada de supervisiones ajenas ni viejas.
create policy supervisiones_update_estado_propia_reciente on public.supervisiones
  as permissive for update to authenticated
  using (es_operador_actual()
         and supervisor_id in (select u.id from usuarios u where u.auth_user_id = auth.uid())
         and created_at > now() - interval '2 hours')
  with check (es_operador_actual()
         and supervisor_id in (select u.id from usuarios u where u.auth_user_id = auth.uid())
         and created_at > now() - interval '2 hours');

revoke update, delete, truncate on table public.supervisiones from authenticated, anon;
grant update (estado) on table public.supervisiones to authenticated;

-- supervision_respuestas / supervision_fotos ---------------------------------------
drop policy if exists supervision_respuestas_alcance on public.supervision_respuestas;
create policy supervision_respuestas_select_alcance on public.supervision_respuestas
  as permissive for select to authenticated
  using (alcanza_supervision_actual(supervision_id));
revoke insert, update, delete, truncate on table public.supervision_respuestas from authenticated, anon;

drop policy if exists supervision_fotos_alcance on public.supervision_fotos;
create policy supervision_fotos_select_alcance on public.supervision_fotos
  as permissive for select to authenticated
  using (alcanza_supervision_actual(supervision_id));
revoke insert, update, delete, truncate on table public.supervision_fotos from authenticated, anon;
