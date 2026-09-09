-- ============================================================================
-- M4 — RLS: cerrar 8 tablas sin uso en el código
-- ============================================================================
--
-- Parte del saneamiento que M1 dejó anunciado ("Se eliminan en M4..M10, por
-- separado" — supabase/migrations/20260725_m1_revoke_anon_tablas.sql:40).
--
-- MOTIVO
-- Diagnóstico Fase 0 del 2026-09-03 contra producción (pg_policies): estas
-- ocho tablas conservan políticas permisivas con qual = true, y la revisión
-- del repositorio del mismo día (app/, components/, lib/) no encontró NINGUNA
-- consulta a ellas, ni desde el navegador ni desde las rutas /api:
--   alertas, camaras, asignaciones, horarios_objetivo, planilla_detalle,
--   planillas_mensuales, reemplazos, repositorio_documental
-- Seis de las ocho no están versionadas en este repositorio, así que los
-- nombres reales de sus políticas sólo constan en producción: por eso el
-- barrido es dinámico (elimina toda política con qual=true / with_check=true,
-- cualquiera sea su nombre) y cada tabla se protege con to_regclass.
--
-- QUÉ HACE, POR TABLA
--   1. Habilita RLS (idempotente).
--   2. Elimina toda política laxa (qual=true, o with_check=true sin qual).
--      No crea reemplazos: sin uso en código, no corresponde ningún acceso.
--   3. Revoca todos los privilegios de anon y authenticated.
--
-- QUÉ NO TOCA
--   * service_role: intacto (hace bypass de RLS; los datos históricos siguen
--     disponibles para el backend si algún día hacen falta).
--   * Ningún dato: no borra ni modifica filas.
--   * Políticas con qual real (si existieran): se conservan.
--
-- ANTES DE EJECUTAR
-- Correr la sección PRE de
-- supabase/verificacion/20260903100000_m4_rls_tablas_muertas_pre_post.sql
-- y GUARDAR su salida: es la fuente autoritativa del rollback exacto.
--
-- ROLLBACK: supabase/rollback/20260903100000_m4_rls_tablas_muertas_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'alertas', 'camaras', 'asignaciones', 'horarios_objetivo',
    'planilla_detalle', 'planillas_mensuales', 'reemplazos',
    'repositorio_documental'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'M4: public.% no existe en esta base, se omite', t;
      continue;
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
      raise notice 'M4: eliminada la política laxa %.%', t, p.policyname;
    end loop;

    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
