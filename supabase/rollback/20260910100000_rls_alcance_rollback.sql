-- ============================================================================
-- ROLLBACK de 20260910100000_rls_alcance_turnos_registros_objetivos.sql
-- ============================================================================
-- Restaura EXACTAMENTE el estado anterior auditado el 2026-09-09.
-- ⚠️ ADVERTENCIA: ese estado anterior incluye los agujeros que la migración
-- cierra (supervisor global en turnos/registros y objetivos abierto a todo
-- autenticado con USING true). Ejecutar sólo para volver atrás de urgencia.
-- Archivo separado a propósito: nunca en el mismo bloque que la migración.
-- ============================================================================

begin;

-- ── 1. TURNOS ───────────────────────────────────────────────────────────────
drop policy if exists turnos_alcance_operativo on public.turnos;

drop policy if exists "Admin CRUD turnos" on public.turnos;
create policy "Admin CRUD turnos"
  on public.turnos
  for all
  to authenticated
  using (exists (select 1 from usuarios
                 where usuarios.auth_user_id = auth.uid()
                   and usuarios.rol = 'admin'::text))
  with check (exists (select 1 from usuarios
                      where usuarios.auth_user_id = auth.uid()
                        and usuarios.rol = 'admin'::text));

drop policy if exists "Supervisor CRUD turnos" on public.turnos;
create policy "Supervisor CRUD turnos"
  on public.turnos
  for all
  to authenticated
  using (exists (select 1 from usuarios
                 where usuarios.auth_user_id = auth.uid()
                   and usuarios.rol = 'supervisor'::text))
  with check (exists (select 1 from usuarios
                      where usuarios.auth_user_id = auth.uid()
                        and usuarios.rol = 'supervisor'::text));

-- ── 2. REGISTROS_ASISTENCIA ─────────────────────────────────────────────────
drop policy if exists registros_asistencia_select_alcance on public.registros_asistencia;

drop policy if exists "Supervisor lee registros_asistencia" on public.registros_asistencia;
create policy "Supervisor lee registros_asistencia"
  on public.registros_asistencia
  for select
  to authenticated
  using (exists (select 1 from usuarios
                 where usuarios.auth_user_id = auth.uid()
                   and usuarios.rol = 'supervisor'::text));

-- ── 3. SUPERVISOR_ZONAS ─────────────────────────────────────────────────────
drop policy if exists supervisor_zonas_lectura_operativa on public.supervisor_zonas;

-- ── 4. OBJETIVOS ────────────────────────────────────────────────────────────
drop policy if exists objetivos_select_usuario_activo on public.objetivos;
drop policy if exists objetivos_insert_admin on public.objetivos;
drop policy if exists objetivos_update_operador on public.objetivos;
drop policy if exists objetivos_delete_admin on public.objetivos;

drop policy if exists "Admin acceso total objetivos" on public.objetivos;
create policy "Admin acceso total objetivos"
  on public.objetivos
  as permissive
  for all
  to public
  using (true);

grant truncate, references, trigger on table public.objetivos to authenticated;

-- ── 5. Helper ───────────────────────────────────────────────────────────────
drop function if exists public.alcanza_turno_actual(uuid);

commit;

notify pgrst, 'reload schema';
