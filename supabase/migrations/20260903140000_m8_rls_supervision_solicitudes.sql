-- ============================================================================
-- M8 — RLS por rol en supervisores_guardia, supervisor_guardia_reglas y
--      solicitudes_admin (+ barrido defensivo en supervisor_intervenciones)
-- ============================================================================
--
-- Continúa el saneamiento M4..M10 anunciado por M1.
--
-- USO REAL DESDE EL NAVEGADOR (revisión del 2026-09-03)
--   supervisores_guardia (política laxa: "Admin acceso total supervisores
--   guardia", 20260617)
--     SELECT: dashboard admin (AppClient.tsx:2356, :9946, :10158, :10341,
--             :11403), móvil de supervisor (SupervisorMobile.tsx:632) y
--             cierre operativo (CierreOperativoPanel.tsx:111).
--     INSERT/UPDATE: sólo dashboard admin (AppClient.tsx:10070, :10181,
--             :10363, :10069, :10088).
--     → SELECT admin/supervisor; INSERT/UPDATE admin.
--   supervisor_guardia_reglas (política laxa: supervisor_guardia_reglas_
--   autenticado, 20260814100000, cuyo propio comentario dice "endurecer por
--   rol es una fase aparte" — esa fase es ésta)
--     SELECT/INSERT/UPDATE: sólo el dashboard admin (AppClient.tsx:9964,
--             :10286, :10285, :10308). → todo admin.
--   solicitudes_admin (política laxa: "Admin acceso total solicitudes admin",
--   20260619)
--     SELECT: bandeja del admin sin filtro (AppClient.tsx:9559) y el
--             supervisor filtrando por sí mismo SOLO en el cliente
--             (SupervisorMobile.tsx:639). La política nueva convierte ese
--             filtro de cortesía en una garantía.
--     INSERT: el supervisor crea su solicitud (SupervisorMobile.tsx:1496).
--     UPDATE: el admin la resuelve (AppClient.tsx:9686).
--     → SELECT admin o solicitante; INSERT con solicitante_id propio;
--       UPDATE admin.
--   supervisor_intervenciones
--     Ya fue endurecida por 20260802210000 (lectura por alcance + inserción
--     autenticada por RPC), pero el diagnóstico de producción del 2026-09-03
--     la sigue listando con una política qual = true. Acá sólo se barre esa
--     política laxa residual, cualquiera sea su nombre; las políticas por
--     alcance existentes NO se tocan.
--
-- ANTES DE EJECUTAR: correr y guardar la sección PRE de
-- supabase/verificacion/20260903140000_m8_rls_supervision_solicitudes_pre_post.sql
--
-- ROLLBACK: supabase/rollback/20260903140000_m8_rls_supervision_solicitudes_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- 1. Barrido de políticas laxas en las cuatro tablas.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'supervisores_guardia', 'supervisor_guardia_reglas',
    'solicitudes_admin', 'supervisor_intervenciones'
  ]
  loop
    for p in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = t
         and (qual = 'true' or (qual is null and with_check = 'true'))
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
      raise notice 'M8: eliminada la política laxa %.%', t, p.policyname;
    end loop;
  end loop;
end $$;

-- 2. supervisores_guardia
drop policy if exists supervisores_guardia_select_operador on public.supervisores_guardia;
create policy supervisores_guardia_select_operador
  on public.supervisores_guardia
  for select
  to authenticated
  using (public.ia_es_operador());

drop policy if exists supervisores_guardia_insert_admin on public.supervisores_guardia;
create policy supervisores_guardia_insert_admin
  on public.supervisores_guardia
  for insert
  to authenticated
  with check (public.ia_es_admin());

drop policy if exists supervisores_guardia_update_admin on public.supervisores_guardia;
create policy supervisores_guardia_update_admin
  on public.supervisores_guardia
  for update
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke delete, truncate, references, trigger
  on table public.supervisores_guardia from authenticated;

-- 3. supervisor_guardia_reglas
drop policy if exists supervisor_guardia_reglas_select_admin on public.supervisor_guardia_reglas;
create policy supervisor_guardia_reglas_select_admin
  on public.supervisor_guardia_reglas
  for select
  to authenticated
  using (public.ia_es_admin());

drop policy if exists supervisor_guardia_reglas_insert_admin on public.supervisor_guardia_reglas;
create policy supervisor_guardia_reglas_insert_admin
  on public.supervisor_guardia_reglas
  for insert
  to authenticated
  with check (public.ia_es_admin());

drop policy if exists supervisor_guardia_reglas_update_admin on public.supervisor_guardia_reglas;
create policy supervisor_guardia_reglas_update_admin
  on public.supervisor_guardia_reglas
  for update
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke delete, truncate, references, trigger
  on table public.supervisor_guardia_reglas from authenticated;

-- 4. solicitudes_admin
drop policy if exists solicitudes_admin_select_propio_o_admin on public.solicitudes_admin;
create policy solicitudes_admin_select_propio_o_admin
  on public.solicitudes_admin
  for select
  to authenticated
  using (
    public.ia_es_admin()
    or solicitante_id = public.rondas_usuario_actual_id()
  );

drop policy if exists solicitudes_admin_insert_propio on public.solicitudes_admin;
create policy solicitudes_admin_insert_propio
  on public.solicitudes_admin
  for insert
  to authenticated
  with check (solicitante_id = public.rondas_usuario_actual_id());

drop policy if exists solicitudes_admin_update_admin on public.solicitudes_admin;
create policy solicitudes_admin_update_admin
  on public.solicitudes_admin
  for update
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke delete, truncate, references, trigger
  on table public.solicitudes_admin from authenticated;

-- 5. supervisor_intervenciones: sólo recorte de privilegios sin uso (las
--    escrituras ya estaban revocadas por 20260802210000; esto suma truncate/
--    references/trigger, que no pasan por RLS).
revoke delete, truncate, references, trigger
  on table public.supervisor_intervenciones from authenticated;

commit;

notify pgrst, 'reload schema';
