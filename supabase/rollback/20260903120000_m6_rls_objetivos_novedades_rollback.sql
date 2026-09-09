-- ============================================================================
-- ROLLBACK de M6 — Restituir el acceso laxo a objetivos y novedades
-- ============================================================================
--
-- Revierte: supabase/migrations/20260903120000_m6_rls_objetivos_novedades.sql
--
-- ATENCIÓN: restituye una configuración INSEGURA. Usar sólo si M6 rompió un
-- flujo de producción; registrar qué pantalla y con qué error antes de
-- reintentar. Preferir la salida guardada de la sección PRE.
-- Recrea los nombres originales del schema.sql. No reconcede nada a anon.
-- NO revierte el GRANT de columnas de UPDATE sobre objetivos (es de 20260815,
-- no de M6).
-- ============================================================================

begin;

-- objetivos
drop policy if exists objetivos_select_usuario_activo on public.objetivos;
drop policy if exists objetivos_insert_admin on public.objetivos;
drop policy if exists objetivos_update_operador on public.objetivos;
drop policy if exists objetivos_delete_admin on public.objetivos;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'objetivos'
       and policyname = 'Admin acceso total objetivos'
  ) then
    create policy "Admin acceso total objetivos" on public.objetivos for all using (true);
  end if;
end $$;

grant truncate, references, trigger on table public.objetivos to authenticated;

-- novedades
drop policy if exists novedades_select_operador on public.novedades;
drop policy if exists novedades_insert_operador on public.novedades;
drop policy if exists novedades_update_operador on public.novedades;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'novedades'
       and policyname = 'Admin acceso total novedades'
  ) then
    create policy "Admin acceso total novedades" on public.novedades for all using (true);
  end if;
end $$;

grant delete, truncate, references, trigger on table public.novedades to authenticated;

commit;

notify pgrst, 'reload schema';

-- Verificación del rollback (debe devolver las 2 políticas originales):
-- select tablename, policyname from pg_policies
--  where schemaname = 'public' and tablename in ('objetivos', 'novedades')
--  order by tablename, policyname;
