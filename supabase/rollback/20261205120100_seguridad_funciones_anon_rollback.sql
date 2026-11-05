-- Rollback de 20261205120100_seguridad_funciones_anon.sql
-- Restituye los EXECUTE tal como estaban en producción el 04/11/2026
-- (proacl leído con SELECT):
--   acceso_habilitado_actual: {postgres, authenticated, service_role, anon}  (sin PUBLIC)
--   current_user_role / current_usuario_id: {PUBLIC, postgres, anon, authenticated, service_role}
--   las otras 29: {PUBLIC, postgres, authenticated, service_role}
-- Reabre la ejecución por anon: usar sólo si la migración rompió algo.

grant execute on function public.acceso_habilitado_actual() to anon;

grant execute on function public.current_user_role() to public, anon, authenticated;
grant execute on function public.current_usuario_id() to public, anon, authenticated;

grant execute on function public.alcanza_turno_actual(uuid) to public, authenticated;
grant execute on function public.salida_anticipada_en_alcance(uuid) to public, authenticated;
grant execute on function public.anular_registro_manual(uuid, text) to public, authenticated;
grant execute on function public.crear_objetivo_operativo(uuid, text, text, text, text, uuid, integer, text, integer, boolean, time without time zone, time without time zone) to public, authenticated;
grant execute on function public.resolver_solicitud_personal_operativo(uuid) to public, authenticated;
grant execute on function public.alcanza_baja_vigilador_actual(uuid) to public, authenticated;
grant execute on function public.alcanza_zona_actual(uuid) to public, authenticated;
grant execute on function public.puede_gestionar_personal_operativo_actual() to public, authenticated;
grant execute on function public.puede_resolver_salida_anticipada(uuid, text) to public, authenticated;
grant execute on function public.salida_anticipada_puesto_actual() to public, authenticated;
grant execute on function public.corregir_fecha_registro_manual(uuid, date, text) to public, authenticated;
grant execute on function public.crear_puesto_principal_por_defecto() to public, authenticated;
grant execute on function public.documental_areas_auditar() to public, authenticated;
grant execute on function public.ronda_intervencion_registrar_zona() to public, authenticated;
grant execute on function public.ronda_puntos_no_dejar_ronda_vacia() to public, authenticated;
grant execute on function public.ronda_puntos_no_duplicado() to public, authenticated;
grant execute on function public.rondas_base_exige_puntos() to public, authenticated;
grant execute on function public.tareas_turno_validar_evidencia() to public, authenticated;
grant execute on function public.tg_auditar_supervisores_guardia() to public, authenticated;
grant execute on function public.tg_touch_supervisor_guardia_reglas() to public, authenticated;
grant execute on function public.trg_evaluacion_publicada_historial() to public, authenticated;
grant execute on function public.trg_registro_alerta_salida() to public, authenticated;
grant execute on function public.trg_registro_detectar_salida_anticipada() to public, authenticated;
grant execute on function public.trg_salidas_anticipadas_historial() to public, authenticated;
grant execute on function public.trg_salidas_anticipadas_recalcular() to public, authenticated;
grant execute on function public.turnos_auditar_alta() to public, authenticated;
grant execute on function public.turnos_completar_puesto() to public, authenticated;
grant execute on function public.turnos_validar_superposicion() to public, authenticated;
grant execute on function public.usuarios_proteger_campos_criticos() to public, authenticated;
