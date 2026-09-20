-- ============================================================================
-- FASE 2A — Turnos de supervisores: cerrar el hueco RLS `USING(true)`
-- ============================================================================
--
-- JC (20/09): `supervisores_guardia` y `supervisor_guardia_reglas` tenían policy
-- ALL `USING(true)` → a nivel DB cualquier autenticado (incluido un VIGILADOR)
-- podía leer/crear/modificar/borrar turnos de supervisores. Se reemplaza por
-- `es_operador_actual()`, que representa exactamente la regla definitiva:
--   vigilador NO; supervisor SÍ (propios y de otros, SIN recorte por zona);
--   jefe_supervisores SÍ; direccion_operativa SÍ; Administración SÍ; Gerencia SÍ.
-- (es_operador_actual = puesto in supervisor/jefe_supervisores/direccion_operativa/
--  administracion/gerencia OR (puesto null & rol admin/supervisor); excluye vigilador.)
--
-- No recorta por zona a los supervisores en este módulo (a propósito). No toca UI,
-- ni Puestos, ni Supervisiones, ni otros gates. Los crons/servidor usan service_role
-- (bypass RLS) → no se ven afectados. Ningún flujo de vigilador lee estas tablas.
--
-- ROLLBACK: supabase/rollback/20260920170000_fase2a_turnos_supervisores_es_operador_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- supervisores_guardia (turnos)
drop policy if exists "Admin acceso total supervisores guardia" on public.supervisores_guardia;
create policy supervisores_guardia_operador on public.supervisores_guardia
  for all to authenticated
  using (public.es_operador_actual())
  with check (public.es_operador_actual());

-- supervisor_guardia_reglas (reglas de generación)
drop policy if exists "supervisor_guardia_reglas_autenticado" on public.supervisor_guardia_reglas;
create policy supervisor_guardia_reglas_operador on public.supervisor_guardia_reglas
  for all to authenticated
  using (public.es_operador_actual())
  with check (public.es_operador_actual());

commit;

notify pgrst, 'reload schema';
