-- ============================================================================
-- M6 — RLS por rol en objetivos y novedades
-- ============================================================================
--
-- Continúa el saneamiento M4..M10 anunciado por M1.
--
-- MOTIVO
-- Ambas tablas tienen "Admin acceso total ..." FOR ALL USING (true): cualquier
-- autenticado (incluido un vigilador) puede hoy crear, editar o borrar
-- objetivos y novedades completos.
--
-- USO REAL DESDE EL NAVEGADOR (revisión del 2026-09-03)
--   objetivos
--     SELECT: todas las pantallas y todos los roles. La app del vigilador
--             lista todos los objetivos para fichar (GuardiaMobile.tsx:666,
--             con lat/lng/radio); embeds en bandeja, rondas y supervisiones.
--     INSERT: alta desde el dashboard admin (AppClient.tsx:3601, :9615).
--     UPDATE: edición admin (AppClient.tsx:3573, :3617, :9650), móvil de
--             supervisor (SupervisorMobile.tsx:1704) y tipo_ubicacion desde
--             GPS (lib/gps-objetivos.ts:195). Las columnas ya están limitadas
--             por el GRANT de columnas de 20260815100000 (lat/lng/radio_metros
--             sólo por RPC). Las tres columnas de nocturnidad que sumó
--             20260903170000 requieren el hotfix aparte
--             20260904100000_hotfix_grant_columnas_nocturnidad_objetivos.sql
--             (bug preexistente, independiente de esta serie).
--     DELETE: borrado físico desde el dashboard admin (AppClient.tsx:3713).
--   novedades
--     SELECT/INSERT/UPDATE desde dashboard y legajo de objetivo
--     (AppClient.tsx:12994, :6314, :6320; lib/legajo-objetivo.ts:168, :411),
--     pantallas de admin y supervisor. La rama guardia del dashboard retorna
--     GuardiaMobile antes de esa carga (AppClient.tsx:13137) y no las lee.
--
-- POLÍTICAS NUEVAS (usan los helpers ya versionados y aplicados:
-- ia_es_admin / ia_es_operador de 20260811100000 y rondas_usuario_actual_id
-- de 20260725_rondas_nativas_base; todos SECURITY DEFINER y con
-- estado = 'activo', así un usuario dado de baja pierde el acceso)
--   objetivos : SELECT usuario del padrón activo; INSERT admin;
--               UPDATE admin/supervisor; DELETE admin.
--   novedades : SELECT/INSERT/UPDATE admin/supervisor; sin DELETE.
--
-- QUÉ NO TOCA: el GRANT de columnas de UPDATE sobre objetivos (20260815);
-- service_role; las RPC de rondas/coberturas.
--
-- ANTES DE EJECUTAR: correr y guardar la sección PRE de
-- supabase/verificacion/20260903120000_m6_rls_objetivos_novedades_pre_post.sql
--
-- ROLLBACK: supabase/rollback/20260903120000_m6_rls_objetivos_novedades_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- 1. Barrido de políticas laxas (por nombre conocido y por qual, por si
--    producción tiene nombres divergentes de los del repo).
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['objetivos', 'novedades']
  loop
    for p in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = t
         and (qual = 'true' or (qual is null and with_check = 'true'))
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
      raise notice 'M6: eliminada la política laxa %.%', t, p.policyname;
    end loop;
  end loop;
end $$;

-- 2. objetivos
drop policy if exists objetivos_select_usuario_activo on public.objetivos;
create policy objetivos_select_usuario_activo
  on public.objetivos
  for select
  to authenticated
  using (public.rondas_usuario_actual_id() is not null);

drop policy if exists objetivos_insert_admin on public.objetivos;
create policy objetivos_insert_admin
  on public.objetivos
  for insert
  to authenticated
  with check (public.ia_es_admin());

drop policy if exists objetivos_update_operador on public.objetivos;
create policy objetivos_update_operador
  on public.objetivos
  for update
  to authenticated
  using (public.ia_es_operador())
  with check (public.ia_es_operador());

drop policy if exists objetivos_delete_admin on public.objetivos;
create policy objetivos_delete_admin
  on public.objetivos
  for delete
  to authenticated
  using (public.ia_es_admin());

-- El DELETE de objetivos es un borrado físico legítimo del navegador
-- (AppClient.tsx:3713): se conserva el privilegio. Se recortan los que no
-- pasan por RLS o no se usan. El UPDATE por columnas de 20260815 no se toca.
revoke truncate, references, trigger on table public.objetivos from authenticated;

-- 3. novedades
drop policy if exists novedades_select_operador on public.novedades;
create policy novedades_select_operador
  on public.novedades
  for select
  to authenticated
  using (public.ia_es_operador());

drop policy if exists novedades_insert_operador on public.novedades;
create policy novedades_insert_operador
  on public.novedades
  for insert
  to authenticated
  with check (public.ia_es_operador());

drop policy if exists novedades_update_operador on public.novedades;
create policy novedades_update_operador
  on public.novedades
  for update
  to authenticated
  using (public.ia_es_operador())
  with check (public.ia_es_operador());

revoke delete, truncate, references, trigger on table public.novedades from authenticated;

commit;

notify pgrst, 'reload schema';
