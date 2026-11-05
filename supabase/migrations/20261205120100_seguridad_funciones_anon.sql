-- ============================================================================
-- Seguridad 1.2 — Funciones SECURITY DEFINER ejecutables por anon
-- ============================================================================
-- Lint de Supabase `anon_security_definer_function_executable`: 32 funciones.
-- En PostgreSQL toda función nueva concede EXECUTE a PUBLIC (y anon hereda
-- de PUBLIC); por eso se revoca de `public` Y de `anon`. No se cambia el
-- cuerpo ni la lógica de ninguna función.
--
-- Clasificación (evidencia en el PR, leída de producción el 04/11/2026):
--   A. Helpers que usan políticas RLS o RPC que la app llama autenticada:
--      conservan EXECUTE para authenticated.
--   B. Helpers internos que sólo llaman otras funciones SECURITY DEFINER
--      (dueño postgres, que conserva EXECUTE) y RPC que la app no llama:
--      quedan sólo para service_role.
--   C. Funciones de trigger: el trigger dispara sin EXECUTE del invocador
--      (verificado en PGlite); quedan sólo para service_role.
--
-- anon no tiene grants en ninguna tabla de public y ninguna política de
-- storage/public para anon usa estas funciones: revocar anon no cambia nada
-- que hoy funcione.
--
-- Corre DESPUÉS de 20261205100000 (Fase 5), que redefine con CREATE OR
-- REPLACE crear_puesto_principal_por_defecto, current_user_role y
-- current_usuario_id: estos REVOKE quedan como estado final.
--
-- Rollback: supabase/rollback/20261205120100_seguridad_funciones_anon_rollback.sql
-- ============================================================================

-- ── A. Usadas por RLS o como RPC autenticada ────────────────────────────────
-- acceso_habilitado_actual: política restrictiva acceso_bloqueado_baja (209
--   políticas, incluida storage.objects), facturacion_puede_actual,
--   puede_operar_rondas_objetivo.
-- alcanza_turno_actual: políticas de registros_asistencia y
--   asistencia_excepciones_autorizadas.
-- salida_anticipada_en_alcance: políticas de salidas_anticipadas(_historial).
-- anular_registro_manual: RPC de Asistencia (AppClient).
-- crear_objetivo_operativo: RPC de AppClient y SupervisorMobile.
-- resolver_solicitud_personal_operativo: RPC de Guardias (supervisor).
revoke execute on function public.acceso_habilitado_actual() from public, anon;
revoke execute on function public.alcanza_turno_actual(uuid) from public, anon;
revoke execute on function public.salida_anticipada_en_alcance(uuid) from public, anon;
revoke execute on function public.anular_registro_manual(uuid, text) from public, anon;
revoke execute on function public.crear_objetivo_operativo(uuid, text, text, text, text, uuid, integer, text, integer, boolean, time without time zone, time without time zone) from public, anon;
revoke execute on function public.resolver_solicitud_personal_operativo(uuid) from public, anon;

grant execute on function public.acceso_habilitado_actual() to authenticated, service_role;
grant execute on function public.alcanza_turno_actual(uuid) to authenticated, service_role;
grant execute on function public.salida_anticipada_en_alcance(uuid) to authenticated, service_role;
grant execute on function public.anular_registro_manual(uuid, text) to authenticated, service_role;
grant execute on function public.crear_objetivo_operativo(uuid, text, text, text, text, uuid, integer, text, integer, boolean, time without time zone, time without time zone) to authenticated, service_role;
grant execute on function public.resolver_solicitud_personal_operativo(uuid) to authenticated, service_role;

-- ── B. Helpers internos y RPC sin uso desde la app ──────────────────────────
-- alcanza_baja_vigilador_actual       → sólo resolver_solicitud_personal_operativo [SD]
-- alcanza_zona_actual                 → sólo crear_objetivo_operativo [SD]
-- puede_gestionar_personal_operativo_actual → sólo resolver_/autoservicio_solicitud_personal_operativo [SD]
-- puede_resolver_salida_anticipada    → sólo resolver_salidas_anticipadas / salidas_anticipadas_del_mes [SD]
-- salida_anticipada_puesto_actual     → sólo salida_anticipada_en_alcance / puede_resolver_salida_anticipada [SD]
-- corregir_fecha_registro_manual      → RPC sin llamadas en el código
-- current_user_role, current_usuario_id → sin uso (ni código, ni políticas, ni funciones)
revoke execute on function public.alcanza_baja_vigilador_actual(uuid) from public, anon, authenticated;
revoke execute on function public.alcanza_zona_actual(uuid) from public, anon, authenticated;
revoke execute on function public.puede_gestionar_personal_operativo_actual() from public, anon, authenticated;
revoke execute on function public.puede_resolver_salida_anticipada(uuid, text) from public, anon, authenticated;
revoke execute on function public.salida_anticipada_puesto_actual() from public, anon, authenticated;
revoke execute on function public.corregir_fecha_registro_manual(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.current_user_role() from public, anon, authenticated;
revoke execute on function public.current_usuario_id() from public, anon, authenticated;

grant execute on function public.alcanza_baja_vigilador_actual(uuid) to service_role;
grant execute on function public.alcanza_zona_actual(uuid) to service_role;
grant execute on function public.puede_gestionar_personal_operativo_actual() to service_role;
grant execute on function public.puede_resolver_salida_anticipada(uuid, text) to service_role;
grant execute on function public.salida_anticipada_puesto_actual() to service_role;
grant execute on function public.corregir_fecha_registro_manual(uuid, date, text) to service_role;
grant execute on function public.current_user_role() to service_role;
grant execute on function public.current_usuario_id() to service_role;

-- ── C. Funciones de trigger ─────────────────────────────────────────────────
revoke execute on function public.crear_puesto_principal_por_defecto() from public, anon, authenticated;
revoke execute on function public.documental_areas_auditar() from public, anon, authenticated;
revoke execute on function public.ronda_intervencion_registrar_zona() from public, anon, authenticated;
revoke execute on function public.ronda_puntos_no_dejar_ronda_vacia() from public, anon, authenticated;
revoke execute on function public.ronda_puntos_no_duplicado() from public, anon, authenticated;
revoke execute on function public.rondas_base_exige_puntos() from public, anon, authenticated;
revoke execute on function public.tareas_turno_validar_evidencia() from public, anon, authenticated;
revoke execute on function public.tg_auditar_supervisores_guardia() from public, anon, authenticated;
revoke execute on function public.tg_touch_supervisor_guardia_reglas() from public, anon, authenticated;
revoke execute on function public.trg_evaluacion_publicada_historial() from public, anon, authenticated;
revoke execute on function public.trg_registro_alerta_salida() from public, anon, authenticated;
revoke execute on function public.trg_registro_detectar_salida_anticipada() from public, anon, authenticated;
revoke execute on function public.trg_salidas_anticipadas_historial() from public, anon, authenticated;
revoke execute on function public.trg_salidas_anticipadas_recalcular() from public, anon, authenticated;
revoke execute on function public.turnos_auditar_alta() from public, anon, authenticated;
revoke execute on function public.turnos_completar_puesto() from public, anon, authenticated;
revoke execute on function public.turnos_validar_superposicion() from public, anon, authenticated;
revoke execute on function public.usuarios_proteger_campos_criticos() from public, anon, authenticated;

grant execute on function public.crear_puesto_principal_por_defecto() to service_role;
grant execute on function public.documental_areas_auditar() to service_role;
grant execute on function public.ronda_intervencion_registrar_zona() to service_role;
grant execute on function public.ronda_puntos_no_dejar_ronda_vacia() to service_role;
grant execute on function public.ronda_puntos_no_duplicado() to service_role;
grant execute on function public.rondas_base_exige_puntos() to service_role;
grant execute on function public.tareas_turno_validar_evidencia() to service_role;
grant execute on function public.tg_auditar_supervisores_guardia() to service_role;
grant execute on function public.tg_touch_supervisor_guardia_reglas() to service_role;
grant execute on function public.trg_evaluacion_publicada_historial() to service_role;
grant execute on function public.trg_registro_alerta_salida() to service_role;
grant execute on function public.trg_registro_detectar_salida_anticipada() to service_role;
grant execute on function public.trg_salidas_anticipadas_historial() to service_role;
grant execute on function public.trg_salidas_anticipadas_recalcular() to service_role;
grant execute on function public.turnos_auditar_alta() to service_role;
grant execute on function public.turnos_completar_puesto() to service_role;
grant execute on function public.turnos_validar_superposicion() to service_role;
grant execute on function public.usuarios_proteger_campos_criticos() to service_role;
