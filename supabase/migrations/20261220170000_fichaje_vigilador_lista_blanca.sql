-- Fichaje del vigilador: lista blanca de lo que puede escribir directo (F-02 / P-03,
-- ex SEG-07) — FASE 1, compatible con la app actual.
--
-- APLICADA en producción el 20/11/2026 (verificada con consultas de catálogo y de datos). Basada en el esquema, policies y triggers VIVOS de
-- producción leídos el 20/11/2026 (sólo lectura).
--
-- Hoy: la policy "Guardia gestiona sus registros" es FOR ALL y authenticated tiene
-- UPDATE. El trigger _registro_liquidable_validar protege horas liquidables, *_final,
-- cobertura, anulación, tipo, turno y vigilador, pero NO hora_entrada_real,
-- hora_salida_real, GPS, geo_ok_*, estado_revision, observacion_supervisor,
-- editado_por, horas_trabajadas ni uniforme_*: el vigilador puede reescribir su
-- fichaje por PostgREST (p. ej. hora_entrada_real = '07:00', estado_revision = 'aprobado').
--
-- Lo que la app del vigilador escribe hoy (components/guardia/GuardiaMobile.tsx; las
-- fotos y evidencias van por /api/upload-evidence con service_role):
--  1. Ingreso (INSERT): guardia_id, turno_id, hora_entrada_real, alerta_entrada,
--     distancia_ingreso_metros, gps_ingreso_estado, latitud/longitud/precision_ingreso;
--     reintento "legado": lat_entrada, lng_entrada.
--  2. Egreso (UPDATE, hora_salida_real NULL → valor): hora_salida_real, horas_trabajadas,
--     distancia_egreso_metros, gps_egreso_estado, latitud/longitud/precision_egreso;
--     reintento "legado": lat_salida, lng_salida.
--  3. Anular egreso (UPDATE, la app lo ofrece hasta 30 min después): pone en NULL
--     hora_salida_real, hora_salida_final, horas_trabajadas, alerta_salida y el GPS
--     de egreso.
--  No hay otro INSERT/UPDATE del vigilador sobre registros_asistencia.
--
-- Qué hace: trigger BEFORE INSERT/UPDATE `registro_00_guarda_fichaje_vigilador`.
-- Se dispara ANTES que los demás triggers BEFORE (orden alfabético: registro_0… <
-- registro_alerta_salida < registros_asistencia_validar_liquidable), así ve lo que
-- mandó el cliente y no lo que calculan los otros triggers (alerta_salida).
-- Actúa SÓLO si: la escritura es directa (current_user authenticated/anon, como en
-- _registro_liquidable_validar: las RPC SECURITY DEFINER y service_role no pasan por
-- acá), es la sentencia original (pg_trigger_depth() = 1) y quien escribe NO es
-- operador (es_operador_actual(): supervisores, jefatura, administración y gerencia
-- siguen como hoy).
--  · INSERT: además de lo del punto 1, sólo valores por defecto (estado_revision
--    'pendiente_supervisor', origen 'operacion', tipo 'fichaje_gps'). Todo lo demás
--    tiene que venir NULL (salida, GPS de egreso, geo_ok_*, alertas GPS, revisión,
--    observaciones, uniforme, foto, horas).
--  · UPDATE: sólo dos transiciones:
--      egreso  — hora_salida_real NULL → valor, junto con horas_trabajadas y el GPS de
--                egreso (que tienen que estar vacíos antes);
--      anular  — hora_salida_real valor → NULL, todo lo que cambia pasa a NULL y la
--                hora de egreso registrada está a no más de 45 min de la hora actual
--                del servidor (Argentina). 45 = los 30 de la app + 15 de tolerancia de
--                reloj del teléfono; también se tolera un teléfono hasta 15 min adelantado.
--    Cualquier otro cambio (hora de entrada, salida ya fijada, GPS de ingreso, geo_ok_*,
--    estado_revision, observacion_supervisor, editado_por, uniforme, etc.) → error
--    'FICHAJE_PROTEGIDO: …'.
--
-- Lo que NO cierra la Fase 1 (queda para la Fase 2, RPC fichar_ingreso/fichar_egreso
-- con la hora del servidor): la hora que manda el teléfono al fichar sigue siendo la
-- del teléfono, y egreso→anular→egreso dentro de la ventana permite mover la salida.
--
-- Rollback: supabase/rollback/20261220170000_fichaje_vigilador_lista_blanca_rollback.sql

create or replace function public.registros_asistencia_guarda_fichaje_vigilador()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  -- INSERT: lo que manda la app al fichar el ingreso (más los valores por defecto).
  c_ingreso constant text[] := array[
    'id', 'created_at', 'turno_id', 'guardia_id', 'hora_entrada_real', 'alerta_entrada',
    'latitud_ingreso', 'longitud_ingreso', 'precision_ingreso', 'distancia_ingreso_metros',
    'gps_ingreso_estado', 'lat_entrada', 'lng_entrada',
    -- con valor por defecto (se validan abajo / en _registro_liquidable_validar):
    'estado_revision', 'origen', 'tipo_registro', 'cierre_automatico'];
  -- UPDATE de egreso: hora_salida_real NULL → valor.
  c_egreso constant text[] := array[
    'hora_salida_real', 'horas_trabajadas', 'latitud_egreso', 'longitud_egreso',
    'precision_egreso', 'distancia_egreso_metros', 'gps_egreso_estado', 'lat_salida', 'lng_salida'];
  -- UPDATE de anulación del egreso: todo lo que cambia pasa a NULL.
  c_anular constant text[] := array[
    'hora_salida_real', 'horas_trabajadas', 'latitud_egreso', 'longitud_egreso',
    'precision_egreso', 'distancia_egreso_metros', 'gps_egreso_estado', 'lat_salida', 'lng_salida',
    'alerta_salida', 'hora_salida_final'];
  v_new jsonb;
  v_old jsonb;
  v_k text;
  v_cambios text[];
  v_min numeric;
begin
  if current_user not in ('authenticated', 'anon') or pg_trigger_depth() > 1 then
    return new;
  end if;
  if public.es_operador_actual() then
    return new;
  end if;

  v_new := to_jsonb(new);

  if tg_op = 'INSERT' then
    for v_k in select jsonb_object_keys(v_new) loop
      if v_k <> all(c_ingreso) and jsonb_typeof(v_new -> v_k) <> 'null' then
        raise exception 'FICHAJE_PROTEGIDO: % no se carga al fichar el ingreso', v_k;
      end if;
    end loop;
    if new.estado_revision is distinct from 'pendiente_supervisor' then
      raise exception 'FICHAJE_PROTEGIDO: estado_revision lo decide el supervisor';
    end if;
    if new.origen is distinct from 'operacion' then
      raise exception 'FICHAJE_PROTEGIDO: origen no se carga al fichar';
    end if;
    return new;
  end if;

  -- UPDATE
  v_old := to_jsonb(old);
  select array_agg(k) into v_cambios
    from jsonb_object_keys(v_new) k
   where (v_new -> k) is distinct from (v_old -> k);
  if v_cambios is null then
    return new;  -- no cambia nada
  end if;

  if old.hora_salida_real is null and new.hora_salida_real is not null then
    -- Egreso.
    foreach v_k in array v_cambios loop
      if v_k <> all(c_egreso) then
        raise exception 'FICHAJE_PROTEGIDO: % no se modifica al fichar el egreso', v_k;
      end if;
      if v_k <> 'horas_trabajadas' and jsonb_typeof(v_old -> v_k) <> 'null' then
        raise exception 'FICHAJE_PROTEGIDO: % ya estaba registrado', v_k;
      end if;
    end loop;
    return new;
  end if;

  if old.hora_salida_real is not null and new.hora_salida_real is null then
    -- Anular egreso.
    foreach v_k in array v_cambios loop
      if v_k <> all(c_anular) or jsonb_typeof(v_new -> v_k) <> 'null' then
        raise exception 'FICHAJE_PROTEGIDO: anular el egreso sólo borra la salida (%)', v_k;
      end if;
    end loop;
    v_min := extract(epoch from ((now() at time zone 'America/Argentina/Buenos_Aires')::time
                                 - old.hora_salida_real)) / 60.0;
    if v_min < 0 then
      v_min := v_min + 1440;  -- cruce de medianoche (o teléfono adelantado)
    end if;
    if v_min > 45 and v_min < 1425 then
      raise exception 'FICHAJE_PROTEGIDO: el egreso sólo se anula en los 30 minutos siguientes';
    end if;
    return new;
  end if;

  raise exception 'FICHAJE_PROTEGIDO: el fichaje ya registrado no se modifica (%)', array_to_string(v_cambios, ', ');
end;
$function$;

revoke all on function public.registros_asistencia_guarda_fichaje_vigilador() from public, anon;
grant execute on function public.registros_asistencia_guarda_fichaje_vigilador() to authenticated, service_role;

drop trigger if exists registro_00_guarda_fichaje_vigilador on public.registros_asistencia;
create trigger registro_00_guarda_fichaje_vigilador
  before insert or update on public.registros_asistencia
  for each row execute function public.registros_asistencia_guarda_fichaje_vigilador();
