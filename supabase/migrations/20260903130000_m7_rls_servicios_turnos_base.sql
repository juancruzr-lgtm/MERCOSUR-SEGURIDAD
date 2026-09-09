-- ============================================================================
-- M7 — RLS por rol en servicios_objetivo y turnos_base
-- ============================================================================
--
-- Continúa el saneamiento M4..M10 anunciado por M1.
--
-- MOTIVO
-- Ninguna de las dos tablas está versionada en el repo (sus CREATE TABLE
-- viven sólo en producción) y ambas figuran en el diagnóstico del 2026-09-03
-- con políticas qual = true: cualquier autenticado puede hoy reescribir la
-- estructura de programación completa.
--
-- USO REAL DESDE EL NAVEGADOR (revisión del 2026-09-03)
--   servicios_objetivo
--     SELECT: dashboard admin (AppClient.tsx:8835, :8940, :3634), Centro
--             Operativo del objetivo (CentroOperativoObjetivo.tsx:238) y
--             lib/puestos.ts:171/:197/:219 — pantallas de admin y supervisor.
--     INSERT/UPDATE: sólo el dashboard admin (AppClient.tsx:8916, :8922).
--   turnos_base
--     SELECT: ABM del dashboard admin (AppClient.tsx:12340, :8838) y embeds
--             turno_base:turnos_base(...) que también carga el supervisor en
--             el Centro Operativo (CentroOperativoObjetivo.tsx:239).
--     INSERT/UPDATE: sólo el ABM admin (AppClient.tsx:12423, :12418, :12439).
--   Las mutaciones de programación del supervisor van por RPC SECURITY
--   DEFINER (crear_turnos_programacion_parcial, asignar_vigilador_turnos,
--   declarar_estructura_programacion, ...) y no dependen de estas políticas.
--
-- POLÍTICAS NUEVAS
--   SELECT admin/supervisor (ia_es_operador); INSERT y UPDATE sólo admin
--   (ia_es_admin); sin DELETE. El vigilador no consulta estas tablas.
--
-- QUÉ NO TOCA: service_role; las RPC de programación; los datos.
--
-- ANTES DE EJECUTAR: correr y guardar la sección PRE de
-- supabase/verificacion/20260903130000_m7_rls_servicios_turnos_base_pre_post.sql
--
-- ROLLBACK: supabase/rollback/20260903130000_m7_rls_servicios_turnos_base_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- 1. RLS habilitada y barrido de políticas laxas (nombres reales sólo en
--    producción: el barrido va por qual, no por nombre).
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['servicios_objetivo', 'turnos_base']
  loop
    if to_regclass(format('public.%I', t)) is null then
      raise exception 'M7: public.% no existe en esta base', t;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for p in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = t
         and (qual = 'true' or (qual is null and with_check = 'true'))
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
      raise notice 'M7: eliminada la política laxa %.%', t, p.policyname;
    end loop;
  end loop;
end $$;

-- 2. servicios_objetivo
drop policy if exists servicios_objetivo_select_operador on public.servicios_objetivo;
create policy servicios_objetivo_select_operador
  on public.servicios_objetivo
  for select
  to authenticated
  using (public.ia_es_operador());

drop policy if exists servicios_objetivo_insert_admin on public.servicios_objetivo;
create policy servicios_objetivo_insert_admin
  on public.servicios_objetivo
  for insert
  to authenticated
  with check (public.ia_es_admin());

drop policy if exists servicios_objetivo_update_admin on public.servicios_objetivo;
create policy servicios_objetivo_update_admin
  on public.servicios_objetivo
  for update
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke delete, truncate, references, trigger
  on table public.servicios_objetivo from authenticated;

-- 3. turnos_base
drop policy if exists turnos_base_select_operador on public.turnos_base;
create policy turnos_base_select_operador
  on public.turnos_base
  for select
  to authenticated
  using (public.ia_es_operador());

drop policy if exists turnos_base_insert_admin on public.turnos_base;
create policy turnos_base_insert_admin
  on public.turnos_base
  for insert
  to authenticated
  with check (public.ia_es_admin());

drop policy if exists turnos_base_update_admin on public.turnos_base;
create policy turnos_base_update_admin
  on public.turnos_base
  for update
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

revoke delete, truncate, references, trigger
  on table public.turnos_base from authenticated;

commit;

notify pgrst, 'reload schema';
