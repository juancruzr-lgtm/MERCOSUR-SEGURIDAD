-- ROLLBACK de 20261008160000_salidas_anticipadas.sql
-- NO se ejecuta junto con la migración. Sólo si hay que deshacerla.
--
-- ⚠️ Borra las salidas detectadas y sus resoluciones, y el historial de
-- evaluaciones. Si alguna evaluación fue corregida por Gerencia, la fila
-- corregida QUEDA como está (las columnas nuevas se eliminan, el contenido no
-- se revierte). Exportar antes salidas_anticipadas, salidas_anticipadas_historial
-- y evaluaciones_mensuales_historial.

begin;

drop trigger if exists evaluacion_publicada_historial on public.evaluaciones_mensuales;
drop trigger if exists registro_detectar_salida_anticipada on public.registros_asistencia;
drop trigger if exists registro_alerta_salida on public.registros_asistencia;

drop function if exists public.corregir_evaluacion_publicada(uuid, numeric, text, jsonb, text, text);
drop function if exists public.salidas_anticipadas_del_mes(text);
drop function if exists public.resolver_salidas_anticipadas(uuid[], text, text, text, text);
drop function if exists public.trg_evaluacion_publicada_historial();
drop function if exists public.trg_registro_detectar_salida_anticipada();
drop function if exists public.trg_registro_alerta_salida();

drop table if exists public.salidas_anticipadas_historial;
drop function if exists public.trg_salidas_anticipadas_historial();
drop table if exists public.salidas_anticipadas;
drop table if exists public.evaluaciones_mensuales_historial;

drop function if exists public.puede_resolver_salida_anticipada(uuid, text);
drop function if exists public.salida_anticipada_en_alcance(uuid);
drop function if exists public.salida_anticipada_puesto_actual();
drop function if exists public.salida_anticipada_instantes(date, time, time, time);

alter table public.evaluaciones_mensuales
  drop column if exists motivo_correccion,
  drop column if exists corregida_por,
  drop column if exists corregida_at,
  drop column if exists version;

notify pgrst, 'reload schema';

commit;
