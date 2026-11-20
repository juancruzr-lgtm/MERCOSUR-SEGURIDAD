-- Políticas (pg_policy), grants de tabla y columna para anon/authenticated/service_role y triggers. Generado con scripts/db-snapshot/consultas.sql (3).

-- Políticas

create policy "Autenticados leen configuración" on public.app_config as permissive for select to authenticated
  using (true);
create policy acceso_bloqueado_baja on public.app_config as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy app_config_config_delete on public.app_config as permissive for delete to authenticated
  using (puede_configurar_sistema_actual());
create policy app_config_config_insert on public.app_config as permissive for insert to authenticated
  with check (puede_configurar_sistema_actual());
create policy app_config_config_update on public.app_config as permissive for update to authenticated
  using (puede_configurar_sistema_actual())
  with check (puede_configurar_sistema_actual());
create policy app_config_sin_secretos on public.app_config as restrictive for select to authenticated, anon
  using ((key !~* '(secret|token|password|api_key)'::text));
create policy asistencia_excepciones_lectura_alcance on public.asistencia_excepciones_autorizadas as permissive for select to authenticated
  using (alcanza_turno_actual(turno_id));
create policy acceso_bloqueado_baja on public.gerencia_delegaciones as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy gerencia_delegaciones_delete on public.gerencia_delegaciones as permissive for delete to authenticated
  using (es_gerencia_actual());
create policy gerencia_delegaciones_insert on public.gerencia_delegaciones as permissive for insert to authenticated
  with check ((es_gerencia_actual() AND (EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = gerencia_delegaciones.usuario_id) AND (u.puesto_organizacional = 'administracion'::text)))) AND (EXISTS ( SELECT 1
   FROM usuarios a
  WHERE ((a.id = gerencia_delegaciones.otorgado_por) AND (a.auth_user_id = auth.uid()))))));
create policy gerencia_delegaciones_select on public.gerencia_delegaciones as permissive for select to authenticated
  using ((es_gerencia_actual() OR (EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = gerencia_delegaciones.usuario_id) AND (u.auth_user_id = auth.uid()))))));
create policy gerencia_delegaciones_update on public.gerencia_delegaciones as permissive for update to authenticated
  using (es_gerencia_actual())
  with check (es_gerencia_actual());
create policy acceso_bloqueado_baja on public.liquidacion_auditoria as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy liquidacion_auditoria_liquidacion on public.liquidacion_auditoria as permissive for all to authenticated
  using (puede_liquidar_actual())
  with check (puede_liquidar_actual());
create policy acceso_bloqueado_baja on public.objetivos as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy objetivos_delete_admin on public.objetivos as permissive for delete to authenticated
  using ((alcance_operativo_de(rondas_usuario_actual_id()) = 'todas'::text));
create policy objetivos_insert_admin on public.objetivos as permissive for insert to authenticated
  with check ((alcance_operativo_de(rondas_usuario_actual_id()) = 'todas'::text));
create policy objetivos_select_usuario_activo on public.objetivos as permissive for select to authenticated
  using ((rondas_usuario_actual_id() IS NOT NULL));
create policy objetivos_update_operador on public.objetivos as permissive for update to authenticated
  using (alcanza_objetivo_actual(id))
  with check (alcanza_objetivo_actual(id));
create policy "Lectura puestos usuarios autenticados" on public.puestos as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE (usuarios.auth_user_id = auth.uid()))));
create policy acceso_bloqueado_baja on public.puestos as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy puestos_delete_alcance on public.puestos as permissive for delete to authenticated
  using (alcanza_objetivo_actual(objetivo_id));
create policy puestos_insert_alcance on public.puestos as permissive for insert to authenticated
  with check (alcanza_objetivo_actual(objetivo_id));
create policy puestos_update_alcance on public.puestos as permissive for update to authenticated
  using (alcanza_objetivo_actual(objetivo_id))
  with check (alcanza_objetivo_actual(objetivo_id));
create policy "Guardia gestiona sus registros" on public.registros_asistencia as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_user_id = auth.uid()) AND (usuarios.rol = ANY (ARRAY['guardia'::text, 'vigilador'::text])) AND (usuarios.id = registros_asistencia.guardia_id)))))
  with check ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_user_id = auth.uid()) AND (usuarios.rol = ANY (ARRAY['guardia'::text, 'vigilador'::text])) AND (usuarios.id = registros_asistencia.guardia_id)))));
create policy acceso_bloqueado_baja on public.registros_asistencia as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy fichaje_borrar_solo_conduccion on public.registros_asistencia as restrictive for delete to authenticated
  using ((( SELECT actor_activo_actual() AS actor_activo_actual) AND ( SELECT es_operador_actual() AS es_operador_actual)));
create policy fichaje_solo_activos_insert on public.registros_asistencia as restrictive for insert to authenticated
  with check (( SELECT actor_activo_actual() AS actor_activo_actual));
create policy fichaje_solo_activos_update on public.registros_asistencia as restrictive for update to authenticated
  using (( SELECT actor_activo_actual() AS actor_activo_actual))
  with check (( SELECT actor_activo_actual() AS actor_activo_actual));
create policy "guardias pueden insertar su asistencia" on public.registros_asistencia as permissive for insert to authenticated
  with check ((guardia_id IN ( SELECT usuarios.id
   FROM usuarios
  WHERE (usuarios.auth_user_id = auth.uid()))));
create policy "guardias pueden ver su asistencia" on public.registros_asistencia as permissive for select to authenticated
  using ((guardia_id IN ( SELECT usuarios.id
   FROM usuarios
  WHERE (usuarios.auth_user_id = auth.uid()))));
create policy registros_asistencia_alcance_total on public.registros_asistencia as permissive for all to authenticated
  using ((alcance_operativo_de(rondas_usuario_actual_id()) = 'todas'::text))
  with check ((alcance_operativo_de(rondas_usuario_actual_id()) = 'todas'::text));
create policy registros_asistencia_select_alcance on public.registros_asistencia as permissive for select to authenticated
  using (alcanza_turno_actual(turno_id));
create policy "Admin lee registros_asistencia_auditoria" on public.registros_asistencia_auditoria as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_user_id = auth.uid()) AND (usuarios.rol = 'admin'::text)))));
create policy "Admin y supervisor insertan auditoria" on public.registros_asistencia_auditoria as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_user_id = auth.uid()) AND (usuarios.rol = ANY (ARRAY['admin'::text, 'supervisor'::text]))))));
create policy acceso_bloqueado_baja on public.registros_asistencia_auditoria as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy acceso_bloqueado_baja on public.supervision_fotos as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy supervision_fotos_alcance on public.supervision_fotos as permissive for all to authenticated
  using (alcanza_supervision_actual(supervision_id))
  with check (alcanza_supervision_actual(supervision_id));
create policy acceso_bloqueado_baja on public.supervision_respuestas as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy supervision_respuestas_alcance on public.supervision_respuestas as permissive for all to authenticated
  using (alcanza_supervision_actual(supervision_id))
  with check (alcanza_supervision_actual(supervision_id));
create policy acceso_bloqueado_baja on public.supervisiones as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy supervisiones_alcance on public.supervisiones as permissive for all to authenticated
  using ((alcanza_objetivo_actual(objetivo_id) OR (es_operador_actual() AND (supervisor_id IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.auth_user_id = auth.uid()))))))
  with check ((alcanza_objetivo_actual(objetivo_id) OR (es_operador_actual() AND (supervisor_id IN ( SELECT u.id
   FROM usuarios u
  WHERE (u.auth_user_id = auth.uid()))))));
create policy "Supervisor select sus asignaciones" on public.supervisor_zonas as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.rol = 'supervisor'::text) AND (u.id = supervisor_zonas.supervisor_id)))));
create policy acceso_bloqueado_baja on public.supervisor_zonas as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy supervisor_zonas_config_delete on public.supervisor_zonas as permissive for delete to authenticated
  using (puede_configurar_sistema_actual());
create policy supervisor_zonas_config_insert on public.supervisor_zonas as permissive for insert to authenticated
  with check (puede_configurar_sistema_actual());
create policy supervisor_zonas_config_select on public.supervisor_zonas as permissive for select to authenticated
  using (puede_configurar_sistema_actual());
create policy supervisor_zonas_config_update on public.supervisor_zonas as permissive for update to authenticated
  using (puede_configurar_sistema_actual())
  with check (puede_configurar_sistema_actual());
create policy supervisor_zonas_lectura_operativa on public.supervisor_zonas as permissive for select to authenticated
  using (es_operador_actual());
create policy "Guardia lee sus turnos" on public.turnos as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.auth_user_id = auth.uid()) AND (usuarios.rol = ANY (ARRAY['guardia'::text, 'vigilador'::text])) AND ((usuarios.id = turnos.guardia_id) OR (usuarios.id = turnos.guardia_original_id))))));
create policy acceso_bloqueado_baja on public.turnos as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy turnos_alcance_operativo on public.turnos as permissive for all to authenticated
  using (alcanza_objetivo_actual(objetivo_id))
  with check (alcanza_objetivo_actual(objetivo_id));
create policy acceso_bloqueado_baja on public.turnos_auditoria as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy acceso_bloqueado_baja on public.usuarios as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy usuarios_delete on public.usuarios as permissive for delete to authenticated
  using (puede_gestionar_usuarios_roles_actual());
create policy usuarios_insert on public.usuarios as permissive for insert to authenticated
  with check (puede_gestionar_personal_actual());
create policy usuarios_select on public.usuarios as permissive for select to authenticated
  using ((es_operador_actual() OR (auth_user_id = auth.uid())));
create policy usuarios_update on public.usuarios as permissive for update to authenticated
  using (puede_gestionar_personal_actual())
  with check (puede_gestionar_personal_actual());
create policy usuarios_vincular_auth on public.usuarios as permissive for update to authenticated
  using (((auth_user_id IS NULL) AND (lower(COALESCE(email, ''::text)) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))
  with check ((auth_user_id = auth.uid()));
create policy "Supervisor select zonas asignadas" on public.zonas_operativas as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM (supervisor_zonas sz
     JOIN usuarios u ON ((u.id = sz.supervisor_id)))
  WHERE ((u.auth_user_id = auth.uid()) AND (u.rol = 'supervisor'::text) AND (sz.zona_id = zonas_operativas.id)))));
create policy acceso_bloqueado_baja on public.zonas_operativas as restrictive for all to authenticated
  using (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual))
  with check (( SELECT acceso_habilitado_actual() AS acceso_habilitado_actual));
create policy zonas_operativas_config_delete on public.zonas_operativas as permissive for delete to authenticated
  using (puede_configurar_sistema_actual());
create policy zonas_operativas_config_insert on public.zonas_operativas as permissive for insert to authenticated
  with check (puede_configurar_sistema_actual());
create policy zonas_operativas_config_select on public.zonas_operativas as permissive for select to authenticated
  using (puede_configurar_sistema_actual());
create policy zonas_operativas_config_update on public.zonas_operativas as permissive for update to authenticated
  using (puede_configurar_sistema_actual())
  with check (puede_configurar_sistema_actual());

-- Grants

revoke all on table public.app_config from public, anon, authenticated, service_role;
revoke all on table public.asistencia_excepciones_autorizadas from public, anon, authenticated, service_role;
revoke all on table public.gerencia_delegaciones from public, anon, authenticated, service_role;
revoke all on table public.liquidacion_auditoria from public, anon, authenticated, service_role;
revoke all on table public.objetivos from public, anon, authenticated, service_role;
revoke all on table public.puestos from public, anon, authenticated, service_role;
revoke all on table public.registros_asistencia from public, anon, authenticated, service_role;
revoke all on table public.registros_asistencia_auditoria from public, anon, authenticated, service_role;
revoke all on table public.supervision_fotos from public, anon, authenticated, service_role;
revoke all on table public.supervision_respuestas from public, anon, authenticated, service_role;
revoke all on table public.supervisiones from public, anon, authenticated, service_role;
revoke all on table public.supervisor_zonas from public, anon, authenticated, service_role;
revoke all on table public.turnos from public, anon, authenticated, service_role;
revoke all on table public.turnos_auditoria from public, anon, authenticated, service_role;
revoke all on table public.usuarios from public, anon, authenticated, service_role;
revoke all on table public.zonas_operativas from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_config to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.app_config to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.asistencia_excepciones_autorizadas to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.gerencia_delegaciones to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.gerencia_delegaciones to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.liquidacion_auditoria to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.liquidacion_auditoria to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.objetivos to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.puestos to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.registros_asistencia to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.registros_asistencia_auditoria to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.registros_asistencia_auditoria to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervision_fotos to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervision_fotos to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervision_respuestas to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervision_respuestas to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervisiones to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervisiones to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervisor_zonas to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.supervisor_zonas to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.turnos to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.turnos to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.turnos_auditoria to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.turnos_auditoria to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.usuarios to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.zonas_operativas to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.zonas_operativas to service_role;
grant delete, insert, maintain, references, select, trigger, update on table public.registros_asistencia to authenticated;
grant delete, insert, maintain, references, trigger, truncate, update on table public.usuarios to authenticated;
grant delete, insert, maintain, select on table public.objetivos to authenticated;
grant delete, insert, maintain, select, update on table public.puestos to authenticated;
grant select on table public.asistencia_excepciones_autorizadas to authenticated;
grant select (acceso_admin_pleno, acceso_auth_bloqueado_at, acceso_bloqueado, acceso_bloqueado_at, acceso_bloqueado_motivo, acceso_bloqueado_por, acceso_facturacion, acceso_interfaz_admin, apellido, auth_user_id, created_at, cuil, dni, email, es_prueba, estado, excluir_pago_banco, foto_url, id, legajo, legajo_visual, nombre, puesto_organizacional, rol, telefono) on table public.usuarios to authenticated;
grant update (checklist_plantilla_id, cliente, direccion, es_prueba, estado, frecuencia_supervision_horas, nombre, tipo_ubicacion, zona_id) on table public.objetivos to authenticated;

-- Triggers

CREATE TRIGGER registros_asistencia_validar_liquidable BEFORE INSERT OR UPDATE ON public.registros_asistencia FOR EACH ROW EXECUTE FUNCTION registros_asistencia_validar_liquidable();
CREATE TRIGGER trg_usuarios_guarda_acceso BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION usuarios_guarda_acceso_bloqueado();
CREATE TRIGGER turnos_updated_at BEFORE UPDATE ON public.turnos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER usuarios_acceso_facturacion_guard BEFORE INSERT OR UPDATE OF acceso_facturacion ON public.usuarios FOR EACH ROW EXECUTE FUNCTION usuarios_acceso_facturacion_guard();
CREATE TRIGGER usuarios_proteger_campos_criticos BEFORE INSERT OR UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION usuarios_proteger_campos_criticos();
