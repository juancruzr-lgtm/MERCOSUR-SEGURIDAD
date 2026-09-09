-- ============================================================================
-- ROLLBACK de M4 — Restituir el acceso laxo a las 8 tablas sin uso
-- ============================================================================
--
-- Revierte: supabase/migrations/20260903100000_m4_rls_tablas_muertas.sql
--
-- ATENCIÓN: restituye una configuración INSEGURA (acceso total de cualquier
-- usuario autenticado a las ocho tablas). Usar sólo si M4 rompió un flujo de
-- producción — cosa que indicaría un consumidor que la revisión del
-- repositorio no encontró: registrar qué se rompió antes de reintentar.
--
-- OPCIÓN A (preferida, exacta): si antes de M4 se guardó la salida de la
-- sección PRE de supabase/verificacion/20260903100000_m4_rls_tablas_muertas_pre_post.sql,
-- recrear las políticas y grants EXACTOS de esa salida, no este archivo.
--
-- OPCIÓN B (genérica, este archivo): recrea una política de acceso total por
-- tabla. Seis tablas no están versionadas y sus nombres de política originales
-- no constan en el repo, así que se usa un nombre nuevo y auditable
-- (<tabla>_rollback_acceso_total); para alertas y camaras el nombre original
-- del schema.sql era "Admin acceso total <tabla>". El acceso resultante es
-- equivalente al previo. No se reconcede nada a anon (eso lo cortó M1 y no
-- es parte de M4).
-- ============================================================================

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'alertas', 'camaras', 'asignaciones', 'horarios_objetivo',
    'planilla_detalle', 'planillas_mensuales', 'reemplazos',
    'repositorio_documental'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

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

-- Verificación del rollback (debe devolver 8 filas, una por tabla existente):
-- select tablename, policyname from pg_policies
--  where schemaname = 'public' and policyname like '%_rollback_acceso_total'
--  order by tablename;
