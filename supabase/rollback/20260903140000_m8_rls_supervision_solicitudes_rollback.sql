-- ============================================================================
-- ROLLBACK de M8 — Restituir el acceso laxo a supervisores_guardia,
--                  supervisor_guardia_reglas y solicitudes_admin
-- ============================================================================
--
-- Revierte: supabase/migrations/20260903140000_m8_rls_supervision_solicitudes.sql
--
-- ATENCIÓN: restituye una configuración INSEGURA. Usar sólo si M8 rompió un
-- flujo de producción; registrar pantalla y error antes de reintentar.
-- Preferir la salida guardada de la sección PRE. Recrea los nombres
-- originales de las migraciones de cada tabla.
--
-- Sobre supervisor_intervenciones: M8 sólo le revocó truncate/references/
-- trigger y barrió una política laxa residual que NO estaba versionada. Este
-- rollback reconcede los privilegios; la política residual, si hiciera falta,
-- sólo puede recrearse desde la salida PRE (las políticas correctas por
-- alcance de 20260802210000 no fueron tocadas).
-- ============================================================================

begin;

-- supervisores_guardia
drop policy if exists supervisores_guardia_select_operador on public.supervisores_guardia;
drop policy if exists supervisores_guardia_insert_admin on public.supervisores_guardia;
drop policy if exists supervisores_guardia_update_admin on public.supervisores_guardia;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'supervisores_guardia'
       and policyname = 'Admin acceso total supervisores guardia'
  ) then
    create policy "Admin acceso total supervisores guardia"
      on public.supervisores_guardia for all using (true);
  end if;
end $$;

grant delete, truncate, references, trigger
  on table public.supervisores_guardia to authenticated;

-- supervisor_guardia_reglas
drop policy if exists supervisor_guardia_reglas_select_admin on public.supervisor_guardia_reglas;
drop policy if exists supervisor_guardia_reglas_insert_admin on public.supervisor_guardia_reglas;
drop policy if exists supervisor_guardia_reglas_update_admin on public.supervisor_guardia_reglas;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'supervisor_guardia_reglas'
       and policyname = 'supervisor_guardia_reglas_autenticado'
  ) then
    create policy supervisor_guardia_reglas_autenticado
      on public.supervisor_guardia_reglas
      for all to authenticated using (true) with check (true);
  end if;
end $$;

grant delete, truncate, references, trigger
  on table public.supervisor_guardia_reglas to authenticated;

-- solicitudes_admin
drop policy if exists solicitudes_admin_select_propio_o_admin on public.solicitudes_admin;
drop policy if exists solicitudes_admin_insert_propio on public.solicitudes_admin;
drop policy if exists solicitudes_admin_update_admin on public.solicitudes_admin;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'solicitudes_admin'
       and policyname = 'Admin acceso total solicitudes admin'
  ) then
    create policy "Admin acceso total solicitudes admin"
      on public.solicitudes_admin for all using (true);
  end if;
end $$;

grant delete, truncate, references, trigger
  on table public.solicitudes_admin to authenticated;

-- supervisor_intervenciones (sólo privilegios; ver cabecera)
grant truncate, references, trigger
  on table public.supervisor_intervenciones to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verificación del rollback (debe devolver las 3 políticas laxas originales):
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and policyname in ('Admin acceso total supervisores guardia',
--                       'supervisor_guardia_reglas_autenticado',
--                       'Admin acceso total solicitudes admin')
--  order by tablename;
