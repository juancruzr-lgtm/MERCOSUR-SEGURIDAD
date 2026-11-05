-- ============================================================================
-- Seguridad 1.1 — Políticas RLS abiertas (qual = true, roles = {public})
-- ============================================================================
-- Auditoría 04/11/2026. En 14 tablas había una política permisiva
-- `using (true)` para {public}: cualquier usuario autenticado (un vigilador
-- incluido) leía y escribía todo, y en supervisor_intervenciones esa política
-- anulaba las de alcance ("Revision operativa lectura por alcance").
--
-- Criterio (ver PR): cada tabla queda con la política mínima que necesita la
-- pantalla que la usa, con los helpers existentes (alcance por objetivo,
-- capacidades, dueño de la fila). Las tablas legadas sin uso en el código
-- quedan sin acceso para `authenticated` (sólo service_role). No se borra
-- ninguna tabla ni dato. La política RESTRICTIVA `acceso_bloqueado_baja` no
-- se toca. Las funciones SECURITY DEFINER (dueño postgres) que escriben estas
-- tablas no dependen de estas políticas ni de los grants de authenticated.
--
-- anon no tiene grants en ninguna de las 14 tablas (verificado en producción);
-- el `revoke ... from anon` es defensivo e idempotente.
-- TRUNCATE/REFERENCES/TRIGGER se revocan de authenticated: TRUNCATE no pasa
-- por RLS y la app nunca los usa.
--
-- Rollback: supabase/rollback/20261205120000_seguridad_rls_politicas_abiertas_rollback.sql
-- ============================================================================

-- ── 1. supervisor_intervenciones ────────────────────────────────────────────
-- Lectura desde el navegador siempre por turno (Revisión Operativa, Panel,
-- SupervisorMobile, cierre). Queda la política de alcance existente, idéntica
-- al alcance de `turnos`. Escritura: sólo RPC SECURITY DEFINER
-- (registrar_intervencion_operativa, etc.); authenticated no tiene INSERT.
drop policy if exists "Acceso total supervisor intervenciones" on public.supervisor_intervenciones;
revoke truncate, references, trigger on public.supervisor_intervenciones from authenticated;
revoke all on public.supervisor_intervenciones from anon;

-- ── 2. solicitudes_admin ────────────────────────────────────────────────────
-- Supervisor: crea y ve las propias (SupervisorMobile, Guardias operativo).
-- Panel "Solicitudes Admin" (shell admin, alcance 'todas'): ve y resuelve.
-- La resolución operativa va por la RPC resolver_solicitud_personal_operativo.
drop policy if exists "Admin acceso total solicitudes admin" on public.solicitudes_admin;
drop policy if exists solicitudes_admin_select on public.solicitudes_admin;
drop policy if exists solicitudes_admin_insert on public.solicitudes_admin;
drop policy if exists solicitudes_admin_update on public.solicitudes_admin;
create policy solicitudes_admin_select on public.solicitudes_admin
  for select to authenticated
  using (
    solicitante_id = (select public.rondas_usuario_actual_id())
    or (select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
    or (select public.puede_acceder_gerencia_actual())
  );
create policy solicitudes_admin_insert on public.solicitudes_admin
  for insert to authenticated
  with check (
    solicitante_id = (select public.rondas_usuario_actual_id())
    and (select public.es_operador_actual())
    and estado = 'pendiente'
    and aprobado_por is null
    and fecha_aprobacion is null
  );
create policy solicitudes_admin_update on public.solicitudes_admin
  for update to authenticated
  using (
    (select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
    or (select public.puede_acceder_gerencia_actual())
  )
  with check (
    (select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
    or (select public.puede_acceder_gerencia_actual())
  );
revoke delete, truncate, references, trigger on public.solicitudes_admin from authenticated;
revoke all on public.solicitudes_admin from anon;

-- ── 3. novedades ────────────────────────────────────────────────────────────
-- Panel/Novedades del shell admin (alcance 'todas'), ficha del objetivo
-- (alcance por objetivo) y "Mis Novedades" del vigilador (propias).
drop policy if exists "Admin acceso total novedades" on public.novedades;
drop policy if exists novedades_select on public.novedades;
drop policy if exists novedades_insert on public.novedades;
drop policy if exists novedades_update on public.novedades;
create policy novedades_select on public.novedades
  for select to authenticated
  using (
    (select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
    or public.alcanza_objetivo_actual(objetivo_id)
    or guardia_id = (select public.rondas_usuario_actual_id())
  );
create policy novedades_insert on public.novedades
  for insert to authenticated
  with check (
    (select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
    or public.alcanza_objetivo_actual(objetivo_id)
    or guardia_id = (select public.rondas_usuario_actual_id())
  );
create policy novedades_update on public.novedades
  for update to authenticated
  using (
    (select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
    or public.alcanza_objetivo_actual(objetivo_id)
  )
  with check (
    (select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
    or public.alcanza_objetivo_actual(objetivo_id)
  );
revoke delete, truncate, references, trigger on public.novedades from authenticated;
revoke all on public.novedades from anon;

-- ── 4. notificaciones_enviadas ──────────────────────────────────────────────
-- Sólo el servidor (service_role) la lee y escribe (rutas /api/push/*). Desde
-- el navegador, a lo sumo, cada persona ve las suyas.
drop policy if exists "Admin acceso total notificaciones enviadas" on public.notificaciones_enviadas;
drop policy if exists notificaciones_enviadas_select_propias on public.notificaciones_enviadas;
create policy notificaciones_enviadas_select_propias on public.notificaciones_enviadas
  for select to authenticated
  using (usuario_id = (select public.rondas_usuario_actual_id()));
revoke insert, update, delete, truncate, references, trigger on public.notificaciones_enviadas from authenticated;
revoke all on public.notificaciones_enviadas from anon;

-- ── 5. push_subscriptions ───────────────────────────────────────────────────
-- Sólo el servidor la usa (/api/push/subscribe, estado, prueba, envíos). Desde
-- el navegador, cada persona administra únicamente sus propias suscripciones.
drop policy if exists "Admin acceso total push subscriptions" on public.push_subscriptions;
drop policy if exists push_subscriptions_propias on public.push_subscriptions;
create policy push_subscriptions_propias on public.push_subscriptions
  for all to authenticated
  using (usuario_id = (select public.rondas_usuario_actual_id()))
  with check (usuario_id = (select public.rondas_usuario_actual_id()));
revoke truncate, references, trigger on public.push_subscriptions from authenticated;
revoke all on public.push_subscriptions from anon;

-- ── 6. servicios_objetivo ───────────────────────────────────────────────────
-- Lectura: ficha/Centro Operativo del objetivo (alcance) y Programación
-- (admin pleno). Alta/edición: Programación (configurar_sistema) o quien
-- gestiona el servicio del objetivo. Las bajas van por RPC (no hay DELETE
-- desde el navegador).
drop policy if exists servicios_objetivo_all on public.servicios_objetivo;
drop policy if exists servicios_objetivo_select on public.servicios_objetivo;
drop policy if exists servicios_objetivo_insert on public.servicios_objetivo;
drop policy if exists servicios_objetivo_update on public.servicios_objetivo;
create policy servicios_objetivo_select on public.servicios_objetivo
  for select to authenticated
  using (
    public.alcanza_objetivo_actual(objetivo_id)
    or (select public.puede_configurar_sistema_actual())
    or (select public.puede_gestionar_servicio_objetivo_actual())
  );
create policy servicios_objetivo_insert on public.servicios_objetivo
  for insert to authenticated
  with check (
    (select public.puede_configurar_sistema_actual())
    or (select public.puede_gestionar_servicio_objetivo_actual())
  );
create policy servicios_objetivo_update on public.servicios_objetivo
  for update to authenticated
  using (
    (select public.puede_configurar_sistema_actual())
    or (select public.puede_gestionar_servicio_objetivo_actual())
  )
  with check (
    (select public.puede_configurar_sistema_actual())
    or (select public.puede_gestionar_servicio_objetivo_actual())
  );
revoke delete, truncate, references, trigger on public.servicios_objetivo from authenticated;
revoke all on public.servicios_objetivo from anon;

-- ── 7. turnos_base ──────────────────────────────────────────────────────────
-- Catálogo de franjas: lo leen los operadores (embebido desde
-- servicios_objetivo en la ficha del objetivo); lo editan sólo en
-- Configuración → Turnos Base.
drop policy if exists turnos_base_all on public.turnos_base;
drop policy if exists turnos_base_select on public.turnos_base;
drop policy if exists turnos_base_insert on public.turnos_base;
drop policy if exists turnos_base_update on public.turnos_base;
create policy turnos_base_select on public.turnos_base
  for select to authenticated
  using (
    (select public.es_operador_actual())
    or (select public.puede_configurar_sistema_actual())
  );
create policy turnos_base_insert on public.turnos_base
  for insert to authenticated
  with check (
    (select public.puede_configurar_sistema_actual())
    or (select public.puede_gestionar_servicio_objetivo_actual())
  );
create policy turnos_base_update on public.turnos_base
  for update to authenticated
  using (
    (select public.puede_configurar_sistema_actual())
    or (select public.puede_gestionar_servicio_objetivo_actual())
  )
  with check (
    (select public.puede_configurar_sistema_actual())
    or (select public.puede_gestionar_servicio_objetivo_actual())
  );
revoke delete, truncate, references, trigger on public.turnos_base from authenticated;
revoke all on public.turnos_base from anon;

-- ── 8. Tablas legadas sin uso en el código ──────────────────────────────────
-- horarios_objetivo (3 filas), asignaciones (1), reemplazos, planillas_mensuales,
-- planilla_detalle, alertas, camaras (0 filas). Ningún archivo de app/, lib/,
-- components/, scripts/ ni supabase/functions las usa y ninguna función
-- SECURITY INVOKER ni vista las lee. Quedan sólo para service_role.
drop policy if exists horarios_select on public.horarios_objetivo;
drop policy if exists horarios_insert on public.horarios_objetivo;
drop policy if exists horarios_update on public.horarios_objetivo;
drop policy if exists horarios_delete on public.horarios_objetivo;
drop policy if exists asignaciones_all on public.asignaciones;
drop policy if exists reemplazos_all on public.reemplazos;
drop policy if exists planillas_all on public.planillas_mensuales;
drop policy if exists planilla_detalle_all on public.planilla_detalle;
drop policy if exists "Admin acceso total alertas" on public.alertas;
drop policy if exists "Admin acceso total camaras" on public.camaras;

revoke all on public.horarios_objetivo, public.asignaciones, public.reemplazos,
  public.planillas_mensuales, public.planilla_detalle, public.alertas, public.camaras
  from authenticated, anon;
grant select, insert, update, delete on public.horarios_objetivo, public.asignaciones, public.reemplazos,
  public.planillas_mensuales, public.planilla_detalle, public.alertas, public.camaras
  to service_role;
