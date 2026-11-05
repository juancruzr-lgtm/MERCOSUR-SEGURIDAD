-- Rollback de 20261205120000_seguridad_rls_politicas_abiertas.sql
-- Vuelve EXACTAMENTE al estado de producción del 04/11/2026: las políticas
-- abiertas (using true, roles {public}) y los grants completos de
-- authenticated. Reabre el agujero de seguridad: usar sólo si la migración
-- rompió una pantalla y no hay arreglo puntual.

-- 1. supervisor_intervenciones (authenticated tenía SELECT, REFERENCES, TRIGGER, TRUNCATE)
drop policy if exists "Acceso total supervisor intervenciones" on public.supervisor_intervenciones;
create policy "Acceso total supervisor intervenciones" on public.supervisor_intervenciones
  for all to public using (true);
grant truncate, references, trigger on public.supervisor_intervenciones to authenticated;

-- 2. solicitudes_admin
drop policy if exists solicitudes_admin_select on public.solicitudes_admin;
drop policy if exists solicitudes_admin_insert on public.solicitudes_admin;
drop policy if exists solicitudes_admin_update on public.solicitudes_admin;
drop policy if exists "Admin acceso total solicitudes admin" on public.solicitudes_admin;
create policy "Admin acceso total solicitudes admin" on public.solicitudes_admin
  for all to public using (true);

-- 3. novedades
drop policy if exists novedades_select on public.novedades;
drop policy if exists novedades_insert on public.novedades;
drop policy if exists novedades_update on public.novedades;
drop policy if exists "Admin acceso total novedades" on public.novedades;
create policy "Admin acceso total novedades" on public.novedades
  for all to public using (true);

-- 4. notificaciones_enviadas
drop policy if exists notificaciones_enviadas_select_propias on public.notificaciones_enviadas;
drop policy if exists "Admin acceso total notificaciones enviadas" on public.notificaciones_enviadas;
create policy "Admin acceso total notificaciones enviadas" on public.notificaciones_enviadas
  for all to public using (true);

-- 5. push_subscriptions
drop policy if exists push_subscriptions_propias on public.push_subscriptions;
drop policy if exists "Admin acceso total push subscriptions" on public.push_subscriptions;
create policy "Admin acceso total push subscriptions" on public.push_subscriptions
  for all to public using (true);

-- 6. servicios_objetivo
drop policy if exists servicios_objetivo_select on public.servicios_objetivo;
drop policy if exists servicios_objetivo_insert on public.servicios_objetivo;
drop policy if exists servicios_objetivo_update on public.servicios_objetivo;
drop policy if exists servicios_objetivo_all on public.servicios_objetivo;
create policy servicios_objetivo_all on public.servicios_objetivo
  for all to public using (true) with check (true);

-- 7. turnos_base
drop policy if exists turnos_base_select on public.turnos_base;
drop policy if exists turnos_base_insert on public.turnos_base;
drop policy if exists turnos_base_update on public.turnos_base;
drop policy if exists turnos_base_all on public.turnos_base;
create policy turnos_base_all on public.turnos_base
  for all to public using (true) with check (true);

-- 8. Legadas
drop policy if exists horarios_select on public.horarios_objetivo;
drop policy if exists horarios_insert on public.horarios_objetivo;
drop policy if exists horarios_update on public.horarios_objetivo;
drop policy if exists horarios_delete on public.horarios_objetivo;
create policy horarios_select on public.horarios_objetivo for select to public using (true);
create policy horarios_insert on public.horarios_objetivo for insert to public with check (true);
create policy horarios_update on public.horarios_objetivo for update to public using (true);
create policy horarios_delete on public.horarios_objetivo for delete to public using (true);
drop policy if exists asignaciones_all on public.asignaciones;
create policy asignaciones_all on public.asignaciones for all to public using (true) with check (true);
drop policy if exists reemplazos_all on public.reemplazos;
create policy reemplazos_all on public.reemplazos for all to public using (true) with check (true);
drop policy if exists planillas_all on public.planillas_mensuales;
create policy planillas_all on public.planillas_mensuales for all to public using (true) with check (true);
drop policy if exists planilla_detalle_all on public.planilla_detalle;
create policy planilla_detalle_all on public.planilla_detalle for all to public using (true) with check (true);
drop policy if exists "Admin acceso total alertas" on public.alertas;
create policy "Admin acceso total alertas" on public.alertas for all to public using (true);
drop policy if exists "Admin acceso total camaras" on public.camaras;
create policy "Admin acceso total camaras" on public.camaras for all to public using (true);

-- Grants de authenticated tal como estaban (todos los privilegios) en las 13 tablas.
grant select, insert, update, delete, truncate, references, trigger on
  public.solicitudes_admin, public.novedades, public.notificaciones_enviadas, public.push_subscriptions,
  public.servicios_objetivo, public.turnos_base, public.horarios_objetivo, public.asignaciones,
  public.reemplazos, public.planillas_mensuales, public.planilla_detalle, public.alertas, public.camaras
  to authenticated;
