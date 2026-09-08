-- ============================================================================
-- RLS novedades_laborales por CAPACIDAD — FASE 2 (Novedades del Personal)
-- ============================================================================
-- La policy previa "Admin CRUD novedades_laborales" era por rol='admin', así que
-- Sergio (rol=admin heredado, puesto=supervisor) podía crear/APROBAR novedades
-- laborales de cualquiera — no corresponde a un supervisor. La gestión de
-- novedades laborales es de ADMINISTRACIÓN (capacidad gestionar_personal).
--
-- Reemplaza esa policy por:
--   · ESCRITURA + lectura de gestión: puede_gestionar_personal_actual()
--     (administración/gerencia). Reusa el helper de ROLES 5 (puesto-aware).
--   · LECTURA operativa: es_operador_actual() — para que Reportes/Desempeño/
--     Cumplimiento de operadores (incl. supervisores como Sergio en su vista) NO
--     pierdan la lectura de novedades aprobadas.
-- Conserva las policies de guardia (lee lo propio) y supervisor (inserta lo
-- propio / lee lo propio), que son operativas y no otorgan a Sergio (rol=admin).
--
-- ROLLBACK: supabase/rollback/20260908150000_rls_novedades_laborales_capacidad_rollback.sql
-- ============================================================================

drop policy if exists "Admin CRUD novedades_laborales" on public.novedades_laborales;
drop policy if exists novedades_laborales_gestion on public.novedades_laborales;
drop policy if exists novedades_laborales_lectura_operativa on public.novedades_laborales;

create policy novedades_laborales_gestion on public.novedades_laborales for all to authenticated
  using ( public.puede_gestionar_personal_actual() )
  with check ( public.puede_gestionar_personal_actual() );

create policy novedades_laborales_lectura_operativa on public.novedades_laborales for select to authenticated
  using ( public.es_operador_actual() );
