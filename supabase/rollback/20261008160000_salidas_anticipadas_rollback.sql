-- ROLLBACK de 20261008160000_salidas_anticipadas.sql (y de su detección
-- 20261008160100). NO se ejecuta junto con la migración. Sólo si hay que
-- deshacerla.
--
-- ⚠️ Borra las salidas detectadas, sus resoluciones y el historial de
-- evaluaciones. Las evaluaciones que se hayan recalculado por salidas QUEDAN
-- como están (se eliminan las columnas nuevas, no se revierte el contenido):
-- para volver atrás una nota, usar la versión guardada en
-- evaluaciones_mensuales_historial ANTES de correr esto. Exportar antes
-- salidas_anticipadas, salidas_anticipadas_historial y
-- evaluaciones_mensuales_historial.

begin;

drop trigger if exists salidas_anticipadas_recalcular on public.salidas_anticipadas;
drop trigger if exists evaluacion_publicada_historial on public.evaluaciones_mensuales;
drop trigger if exists registro_detectar_salida_anticipada on public.registros_asistencia;
drop trigger if exists registro_alerta_salida on public.registros_asistencia;

drop function if exists public.trg_salidas_anticipadas_recalcular();
drop function if exists public.recalcular_evaluacion_por_salidas(uuid, text);
drop function if exists public.evaluacion_numero_texto(numeric);
drop function if exists public.salida_anticipada_vigente(text);
drop function if exists public.salida_anticipada_historial(uuid);
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

-- registrar_lectura_evaluacion tal como estaba en producción el 08/10/2026.
create or replace function public.registrar_lectura_evaluacion(p_evaluacion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare v_uid uuid; v_empleado uuid; v_eval public.evaluaciones_mensuales; v_ya boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'no_autenticado'); end if;
  v_empleado := (select id from public.usuarios where auth_user_id = v_uid and estado = 'activo' limit 1);
  if v_empleado is null then return jsonb_build_object('ok', false, 'motivo', 'usuario_inactivo'); end if;
  v_eval := (select e from public.evaluaciones_mensuales e where e.id = p_evaluacion_id);
  if v_eval.id is null then return jsonb_build_object('ok', false, 'motivo', 'inexistente'); end if;
  if v_eval.empleado_id <> v_empleado then return jsonb_build_object('ok', false, 'motivo', 'no_es_suya'); end if;
  if v_eval.estado <> 'publicada' then return jsonb_build_object('ok', false, 'motivo', 'no_publicada'); end if;
  v_ya := exists (select 1 from public.lecturas_evaluacion where evaluacion_id = p_evaluacion_id and empleado_id = v_empleado);
  insert into public.lecturas_evaluacion (evaluacion_id, empleado_id, periodo, auth_user_id)
  values (p_evaluacion_id, v_empleado, v_eval.periodo, v_uid)
  on conflict on constraint lectura_evaluacion_unica do nothing;
  return jsonb_build_object('ok', true, 'primera_vez', not v_ya);
end; $fn$;

alter table public.lecturas_evaluacion drop column if exists version_vista;

notify pgrst, 'reload schema';

commit;
