-- Rollback de 20261205120200_seguridad_search_path.sql
-- Vuelve las 18 funciones a search_path mutable (sin proconfig), como en
-- producción el 04/11/2026.

alter function public.asistencia_excepciones_inmutable() reset search_path;
alter function public.calcular_horas_liquidables(time without time zone, time without time zone, time without time zone, time without time zone) reset search_path;
alter function public.calcular_horas_reconocidas(time without time zone, time without time zone, time without time zone, time without time zone) reset search_path;
alter function public.cerrar_turnos_abiertos() reset search_path;
alter function public.evaluacion_numero_texto(numeric) reset search_path;
alter function public.fact_comprobante_inmutable() reset search_path;
alter function public.fact_historial_inmutable() reset search_path;
alter function public.fact_letra(integer) reset search_path;
alter function public.fact_mes_prestacion(date) reset search_path;
alter function public.grupo_orden_banco(text, text) reset search_path;
alter function public.repdoc_upsert_atomico(uuid, text, text, text, text, text, text, bigint, timestamp with time zone, timestamp with time zone, text, text) reset search_path;
alter function public.salida_anticipada_vigente(text) reset search_path;
alter function public.set_actualizado_at() reset search_path;
alter function public.set_updated_at() reset search_path;
alter function public.touch_checklist_plantillas_updated_at() reset search_path;
alter function public.turnos_historial_inmutable() reset search_path;
alter function public.update_updated_at() reset search_path;
alter function public.validar_puesto_servicio() reset search_path;
