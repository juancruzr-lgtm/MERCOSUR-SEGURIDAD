-- Rollback 20261220160000_supervisiones_sin_edicion_directa: vuelve EXACTAMENTE a las
-- policies y grants vivos de producción leídos el 20/11/2026 (antes de la migración).
-- Correr como archivo aparte, nunca junto a la migración.

drop policy if exists supervisiones_select_alcance on public.supervisiones;
drop policy if exists supervisiones_insert_alcance on public.supervisiones;
drop policy if exists supervisiones_update_estado_propia_reciente on public.supervisiones;
create policy supervisiones_alcance on public.supervisiones as permissive for all to authenticated
  using ((alcanza_objetivo_actual(objetivo_id) OR (es_operador_actual() AND (supervisor_id IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.auth_user_id = auth.uid()))))))
  with check ((alcanza_objetivo_actual(objetivo_id) OR (es_operador_actual() AND (supervisor_id IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.auth_user_id = auth.uid()))))));
revoke update (estado) on table public.supervisiones from authenticated;
grant update, delete, truncate on table public.supervisiones to authenticated;

drop policy if exists supervision_respuestas_select_alcance on public.supervision_respuestas;
create policy supervision_respuestas_alcance on public.supervision_respuestas as permissive for all to authenticated
  using (alcanza_supervision_actual(supervision_id))
  with check (alcanza_supervision_actual(supervision_id));
grant insert, update, delete, truncate on table public.supervision_respuestas to authenticated;

drop policy if exists supervision_fotos_select_alcance on public.supervision_fotos;
create policy supervision_fotos_alcance on public.supervision_fotos as permissive for all to authenticated
  using (alcanza_supervision_actual(supervision_id))
  with check (alcanza_supervision_actual(supervision_id));
grant insert, update, delete, truncate on table public.supervision_fotos to authenticated;
