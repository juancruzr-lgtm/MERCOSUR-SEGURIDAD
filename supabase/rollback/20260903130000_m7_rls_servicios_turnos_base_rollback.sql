-- ============================================================================
-- ROLLBACK de M7 — Restituir el acceso laxo a servicios_objetivo y turnos_base
-- ============================================================================
--
-- Revierte: supabase/migrations/20260903130000_m7_rls_servicios_turnos_base.sql
--
-- ATENCIÓN: restituye una configuración INSEGURA. Usar sólo si M7 rompió un
-- flujo de producción; registrar pantalla y error antes de reintentar.
-- Las dos tablas no están versionadas: los nombres originales de sus
-- políticas sólo constan en la salida guardada de la sección PRE — preferir
-- ESA salida. Este archivo usa nombres nuevos y auditables.
-- ============================================================================

begin;

drop policy if exists servicios_objetivo_select_operador on public.servicios_objetivo;
drop policy if exists servicios_objetivo_insert_admin on public.servicios_objetivo;
drop policy if exists servicios_objetivo_update_admin on public.servicios_objetivo;

drop policy if exists turnos_base_select_operador on public.turnos_base;
drop policy if exists turnos_base_insert_admin on public.turnos_base;
drop policy if exists turnos_base_update_admin on public.turnos_base;

do $$
declare
  t text;
begin
  foreach t in array array['servicios_objetivo', 'turnos_base']
  loop
    execute format('grant all on table public.%I to authenticated', t);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and policyname = t || '_rollback_acceso_total'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        t || '_rollback_acceso_total', t
      );
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';

-- Verificación del rollback (debe devolver 2 filas):
-- select tablename, policyname from pg_policies
--  where schemaname = 'public' and policyname like '%_rollback_acceso_total'
--    and tablename in ('servicios_objetivo', 'turnos_base')
--  order by tablename;
