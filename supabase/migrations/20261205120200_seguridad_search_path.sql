-- ============================================================================
-- Seguridad 1.3 — search_path fijo en 18 funciones
-- ============================================================================
-- Lint de Supabase `function_search_path_mutable`. Sin search_path fijo, una
-- función resuelve los nombres sin esquema según la sesión que la llama.
--
-- Se revisó el cuerpo vivo de las 18 (pg_proc.prosrc en producción): sólo
-- usan tablas/funciones de `public` (registros_asistencia, turnos,
-- repositorio_documental, puestos, calcular_horas_liquidables) y funciones
-- de pg_catalog. Ninguna usa extensions.*, net.*, auth.* ni vault.*. Por eso
-- `public, pg_catalog`, la misma convención que el resto de las funciones del
-- proyecto. No cambia ningún cuerpo ni resultado.
--
-- Corre DESPUÉS de 20261205100000 (Fase 5), que redefine con CREATE OR
-- REPLACE set_actualizado_at, update_updated_at y repdoc_upsert_atomico
-- (CREATE OR REPLACE resetea proconfig): este ALTER queda como estado final.
--
-- Nota: en las funciones SQL inmutables (fact_letra, fact_mes_prestacion,
-- evaluacion_numero_texto, grupo_orden_banco, salida_anticipada_vigente) un
-- SET impide que el planificador las "inline"; el costo es despreciable
-- (no se usan en índices ni en consultas masivas).
--
-- Rollback: supabase/rollback/20261205120200_seguridad_search_path_rollback.sql
-- ============================================================================

alter function public.asistencia_excepciones_inmutable() set search_path = public, pg_catalog;
alter function public.calcular_horas_liquidables(time without time zone, time without time zone, time without time zone, time without time zone) set search_path = public, pg_catalog;
alter function public.calcular_horas_reconocidas(time without time zone, time without time zone, time without time zone, time without time zone) set search_path = public, pg_catalog;
alter function public.cerrar_turnos_abiertos() set search_path = public, pg_catalog;
alter function public.evaluacion_numero_texto(numeric) set search_path = public, pg_catalog;
alter function public.fact_comprobante_inmutable() set search_path = public, pg_catalog;
alter function public.fact_historial_inmutable() set search_path = public, pg_catalog;
alter function public.fact_letra(integer) set search_path = public, pg_catalog;
alter function public.fact_mes_prestacion(date) set search_path = public, pg_catalog;
alter function public.grupo_orden_banco(text, text) set search_path = public, pg_catalog;
alter function public.repdoc_upsert_atomico(uuid, text, text, text, text, text, text, bigint, timestamp with time zone, timestamp with time zone, text, text) set search_path = public, pg_catalog;
alter function public.salida_anticipada_vigente(text) set search_path = public, pg_catalog;
alter function public.set_actualizado_at() set search_path = public, pg_catalog;
alter function public.set_updated_at() set search_path = public, pg_catalog;
alter function public.touch_checklist_plantillas_updated_at() set search_path = public, pg_catalog;
alter function public.turnos_historial_inmutable() set search_path = public, pg_catalog;
alter function public.update_updated_at() set search_path = public, pg_catalog;
alter function public.validar_puesto_servicio() set search_path = public, pg_catalog;
