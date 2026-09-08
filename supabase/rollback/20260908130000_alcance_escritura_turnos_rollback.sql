-- ROLLBACK de 20260908130000_alcance_escritura_turnos.sql
-- Restaura las RPC de escritura y las policies a su versión previa (por rol) y
-- elimina alcanza_objetivo_actual. No toca datos.
begin;

-- publicar_turnos_programacion (previa)
CREATE OR REPLACE FUNCTION public.publicar_turnos_programacion(p_objetivo_id uuid, p_turno_ids uuid[], p_alcance text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
                                                                                                                                                                                                                                                              DECLARE
                                                                                                                                                                                                                                                                v_uid         uuid;
                                                                                                                                                                                                                                                                  v_actor       record;
                                                                                                                                                                                                                                                                    v_zonas       uuid[];
                                                                                                                                                                                                                                                                      v_objetivo    record;
                                                                                                                                                                                                                                                                        v_tid         uuid;
                                                                                                                                                                                                                                                                          v_turno       record;
                                                                                                                                                                                                                                                                            v_res         text;
                                                                                                                                                                                                                                                                              v_motivo      text;
                                                                                                                                                                                                                                                                                v_filas       jsonb := '[]'::jsonb;
                                                                                                                                                                                                                                                                                  v_publicados  integer := 0;
                                                                                                                                                                                                                                                                                    v_ya          integer := 0;
                                                                                                                                                                                                                                                                                      v_omitidos    integer := 0;
                                                                                                                                                                                                                                                                                        v_puesto_ids  uuid[] := '{}';
                                                                                                                                                                                                                                                                                          v_turno_ids   uuid[] := '{}';
                                                                                                                                                                                                                                                                                          BEGIN
                                                                                                                                                                                                                                                                                            v_uid := auth.uid();
                                                                                                                                                                                                                                                                                              IF v_uid IS NULL THEN
                                                                                                                                                                                                                                                                                                  RAISE EXCEPTION 'No autenticado';
                                                                                                                                                                                                                                                                                                    END IF;

                                                                                                                                                                                                                                                                                                      SELECT id, rol INTO v_actor
                                                                                                                                                                                                                                                                                                        FROM public.usuarios
                                                                                                                                                                                                                                                                                                          WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
                                                                                                                                                                                                                                                                                                            IF NOT FOUND THEN
                                                                                                                                                                                                                                                                                                                RAISE EXCEPTION 'No autorizado: la publicacion de programacion es de administracion o supervision';
                                                                                                                                                                                                                                                                                                                  END IF;

                                                                                                                                                                                                                                                                                                                    IF v_actor.rol = 'supervisor' THEN
                                                                                                                                                                                                                                                                                                                        SELECT array_agg(zona_id) INTO v_zonas FROM public.supervisor_zonas WHERE supervisor_id = v_actor.id;
                                                                                                                                                                                                                                                                                                                          END IF;

                                                                                                                                                                                                                                                                                                                            SELECT id, estado, zona_id INTO v_objetivo FROM public.objetivos WHERE id = p_objetivo_id;
                                                                                                                                                                                                                                                                                                                              IF NOT FOUND THEN
                                                                                                                                                                                                                                                                                                                                  RAISE EXCEPTION 'Objetivo inexistente';
                                                                                                                                                                                                                                                                                                                                    END IF;
                                                                                                                                                                                                                                                                                                                                      IF v_actor.rol = 'supervisor' AND v_zonas IS NOT NULL AND NOT (v_objetivo.zona_id = ANY (v_zonas)) THEN
                                                                                                                                                                                                                                                                                                                                          RAISE EXCEPTION 'Objetivo fuera de la zona del supervisor';
                                                                                                                                                                                                                                                                                                                                            END IF;

                                                                                                                                                                                                                                                                                                                                              IF p_turno_ids IS NULL OR array_length(p_turno_ids, 1) IS NULL THEN
                                                                                                                                                                                                                                                                                                                                                  RAISE EXCEPTION 'No hay turnos seleccionados';
                                                                                                                                                                                                                                                                                                                                                    END IF;
                                                                                                                                                                                                                                                                                                                                                      IF array_length(p_turno_ids, 1) > 1000 THEN
                                                                                                                                                                                                                                                                                                                                                          RAISE EXCEPTION 'Demasiados turnos para una sola operacion (maximo 1000)';
                                                                                                                                                                                                                                                                                                                                                            END IF;

                                                                                                                                                                                                                                                                                                                                                              FOREACH v_tid IN ARRAY p_turno_ids LOOP
                                                                                                                                                                                                                                                                                                                                                                  v_res := 'omitido';
                                                                                                                                                                                                                                                                                                                                                                      v_motivo := NULL;
                                                                                                                                                                                                                                                                                                                                                                          BEGIN
                                                                                                                                                                                                                                                                                                                                                                                SELECT * INTO v_turno FROM public.turnos WHERE id = v_tid FOR UPDATE;
                                                                                                                                                                                                                                                                                                                                                                                      IF NOT FOUND THEN
                                                                                                                                                                                                                                                                                                                                                                                              RAISE EXCEPTION 'Turno inexistente';
                                                                                                                                                                                                                                                                                                                                                                                                    END IF;
                                                                                                                                                                                                                                                                                                                                                                                                          IF v_turno.objetivo_id <> p_objetivo_id THEN
                                                                                                                                                                                                                                                                                                                                                                                                                  RAISE EXCEPTION 'El turno no pertenece al objetivo indicado';
                                                                                                                                                                                                                                                                                                                                                                                                                        END IF;

                                                                                                                                                                                                                                                                                                                                                                                                                              IF v_turno.publicado THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                      v_res := 'ya_publicado';
                                                                                                                                                                                                                                                                                                                                                                                                                                            ELSIF COALESCE(v_turno.estado, '') IN ('reemplazado', 'anulado', 'cancelado') THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                    RAISE EXCEPTION 'Turno sin obligacion de cobertura';
                                                                                                                                                                                                                                                                                                                                                                                                                                                          ELSIF v_turno.puesto_id IS NULL THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                  RAISE EXCEPTION 'Turno sin posicion operativa';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ELSIF v_turno.fecha IS NULL OR v_turno.hora_inicio IS NULL OR v_turno.hora_fin IS NULL
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    OR v_turno.hora_inicio = v_turno.hora_fin THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            RAISE EXCEPTION 'Turno con datos inconsistentes';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  ELSE
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          UPDATE public.turnos
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  SET publicado = true, publicado_at = now(), publicado_por = v_actor.id
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          WHERE id = v_turno.id;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  v_res := 'publicado';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          v_puesto_ids := array_append(v_puesto_ids, v_turno.puesto_id);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  v_turno_ids := array_append(v_turno_ids, v_turno.id);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        END IF;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            EXCEPTION WHEN OTHERS THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  v_res := 'omitido';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        v_motivo := SQLERRM;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            END;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                IF v_res = 'publicado' THEN v_publicados := v_publicados + 1;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    ELSIF v_res = 'ya_publicado' THEN v_ya := v_ya + 1;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ELSE v_omitidos := v_omitidos + 1;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            END IF;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                v_filas := v_filas || jsonb_build_object('turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  END LOOP;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    IF v_publicados > 0 THEN
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        SELECT array_agg(DISTINCT x) INTO v_puesto_ids FROM unnest(v_puesto_ids) x;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            INSERT INTO public.programacion_publicaciones
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  (objetivo_id, usuario_id, auth_user_id, alcance, puesto_ids, turno_ids, cantidad_turnos, cantidad_omitidos)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      VALUES (p_objetivo_id, v_actor.id, v_uid, p_alcance, v_puesto_ids, v_turno_ids, v_publicados, v_omitidos);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        END IF;

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          RETURN jsonb_build_object(
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              'objetivo_id', p_objetivo_id,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  'solicitados', array_length(p_turno_ids, 1),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      'publicados', v_publicados,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          'ya_publicados', v_ya,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              'omitidos', v_omitidos,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  'filas', v_filas
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    );
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    END;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    $function$;

-- asignar_vigilador_turnos (previa)
CREATE OR REPLACE FUNCTION public.asignar_vigilador_turnos(p_operacion_id uuid, p_guardia_id uuid, p_turno_ids uuid[], p_masiva boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid; v_actor record; v_zonas uuid[]; v_guardia record; v_tid uuid; v_turno record;
  v_hoy_arg date; v_hora_arg time; v_ini1 timestamp; v_fin1 timestamp;
  v_res text; v_motivo text; v_filas jsonb := '[]'::jsonb;
  v_asignadas integer := 0; v_ya integer := 0; v_omitidas integer := 0; v_comentario text;
  v_conf record; v_conflicto jsonb; v_nombre text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id, rol into v_actor from public.usuarios
  where auth_user_id = v_uid and estado = 'activo' and rol in ('admin','supervisor');
  if not found then raise exception 'No autorizado: la asignacion es de administracion o supervision'; end if;
  if v_actor.rol = 'supervisor' then
    select array_agg(zona_id) into v_zonas from public.supervisor_zonas where supervisor_id = v_actor.id;
  end if;
  if p_operacion_id is null then raise exception 'operacion_id requerido'; end if;
  if p_guardia_id is null then raise exception 'Vigilador requerido'; end if;
  if p_turno_ids is null or array_length(p_turno_ids,1) is null then raise exception 'No hay turnos seleccionados'; end if;
  if array_length(p_turno_ids,1) > 100 then raise exception 'Demasiados turnos para una sola operacion (maximo 100)'; end if;
  select estado, rol, apellido, nombre into v_guardia from public.usuarios where id = p_guardia_id;
  if not found or v_guardia.estado <> 'activo' or v_guardia.rol not in ('guardia','vigilador') then
    raise exception 'El vigilador elegido no esta activo'; end if;
  v_nombre := trim(both ', ' from concat_ws(', ',
    nullif(trim(coalesce(v_guardia.apellido,'')),''), nullif(trim(coalesce(v_guardia.nombre,'')),'')));
  if v_nombre = '' then v_nombre := 'el vigilador'; end if;
  v_hoy_arg  := ((now() at time zone 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() at time zone 'UTC') - interval '3 hours')::time;
  v_comentario := 'Asignacion ' || case when p_masiva then 'masiva' else 'individual' end
    || ' de vigilador (operacion ' || p_operacion_id::text || ')';
  foreach v_tid in array p_turno_ids loop
    v_res := 'omitida'; v_motivo := null; v_conflicto := null;
    begin
      select t.*, o.estado as objetivo_estado, o.zona_id as objetivo_zona, p.activo as puesto_activo
      into v_turno from public.turnos t
      join public.objetivos o on o.id = t.objetivo_id
      left join public.puestos p on p.id = t.puesto_id
      where t.id = v_tid for update of t;
      if not found then raise exception 'Turno inexistente'; end if;
      if v_turno.objetivo_estado <> 'activo' then raise exception 'Objetivo inactivo'; end if;
      if v_actor.rol = 'supervisor' and v_zonas is not null and not (v_turno.objetivo_zona = any (v_zonas)) then
        raise exception 'Objetivo fuera de la zona del supervisor'; end if;
      if v_turno.puesto_id is not null and v_turno.puesto_activo is distinct from true then
        raise exception 'Posicion operativa inactiva'; end if;
      if coalesce(v_turno.estado,'') in ('reemplazado','anulado','cancelado') then
        raise exception 'Turno sin obligacion de cobertura'; end if;
      if coalesce(v_turno.tipo_evento,'normal') <> 'normal' then
        raise exception 'Solo se asignan turnos de cobertura normal'; end if;
      if v_turno.fecha < v_hoy_arg or (v_turno.fecha = v_hoy_arg and v_turno.hora_inicio <= v_hora_arg) then
        raise exception 'El turno ya inicio o es pasado'; end if;
      perform 1 from public.registros_asistencia r
      where r.turno_id = v_turno.id and coalesce(r.tipo_registro,'') <> 'ausencia'
        and (r.hora_entrada_real is not null or r.hora_entrada_final is not null);
      if found then raise exception 'El turno ya tiene asistencia registrada'; end if;
      if v_turno.guardia_id is not null then
        if v_turno.guardia_id = p_guardia_id then
          v_res := 'ya_asignada'; v_motivo := 'Ya estaba asignado a este vigilador';
        else raise exception 'Ya asignado a otro vigilador: reasignar desde la edicion del turno'; end if;
      else
        v_ini1 := v_turno.fecha + v_turno.hora_inicio;
        v_fin1 := v_turno.fecha + v_turno.hora_fin
          + case when v_turno.hora_fin <= v_turno.hora_inicio then interval '1 day' else interval '0 day' end;
        select t2.id, t2.fecha, t2.hora_inicio, t2.hora_fin, o2.nombre as objetivo_nombre, p2.nombre as puesto_nombre
        into v_conf from public.turnos t2
        join public.objetivos o2 on o2.id = t2.objetivo_id
        left join public.puestos p2 on p2.id = t2.puesto_id
        where t2.guardia_id = p_guardia_id and t2.id <> v_turno.id
          and coalesce(t2.estado,'') not in ('reemplazado','anulado','cancelado')
          and o2.estado = 'activo'
          and t2.fecha between v_turno.fecha - 1 and v_turno.fecha + 1
          and (t2.fecha + t2.hora_inicio) < v_fin1
          and v_ini1 < (t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end)
        order by t2.fecha, t2.hora_inicio limit 1;
        if found then
          v_conflicto := jsonb_build_object('turno_id', v_conf.id, 'vigilador', v_nombre,
            'objetivo', v_conf.objetivo_nombre, 'puesto', v_conf.puesto_nombre, 'fecha', v_conf.fecha,
            'hora_inicio', to_char(v_conf.hora_inicio,'HH24:MI'), 'hora_fin', to_char(v_conf.hora_fin,'HH24:MI'));
          raise exception 'No se puede asignar a %. Ya tiene un turno de % a % en % el %.',
            v_nombre, to_char(v_conf.hora_inicio,'HH24:MI'), to_char(v_conf.hora_fin,'HH24:MI'),
            coalesce(v_conf.objetivo_nombre,'otro objetivo')
              || case when v_conf.puesto_nombre is null then '' else ' (' || v_conf.puesto_nombre || ')' end,
            to_char(v_conf.fecha,'DD/MM/YYYY');
        end if;
        update public.turnos set guardia_id = p_guardia_id,
          guardia_original_id = coalesce(guardia_original_id, p_guardia_id) where id = v_turno.id;
        insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
        values (v_turno.id, v_actor.id, 'guardia_id', null, p_guardia_id::text, v_comentario);
        if v_turno.guardia_original_id is null then
          insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
          values (v_turno.id, v_actor.id, 'guardia_original_id', null, p_guardia_id::text, v_comentario);
        end if;
        v_res := 'asignada';
      end if;
    exception when others then v_res := 'omitida'; v_motivo := sqlerrm;
    end;
    if v_res = 'asignada' then v_asignadas := v_asignadas + 1;
    elsif v_res = 'ya_asignada' then v_ya := v_ya + 1;
    else v_omitidas := v_omitidas + 1; end if;
    v_filas := v_filas || jsonb_build_object('turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo, 'conflicto', v_conflicto);
  end loop;
  return jsonb_build_object('operacion_id', p_operacion_id, 'guardia_id', p_guardia_id,
    'solicitadas', array_length(p_turno_ids,1), 'asignadas', v_asignadas,
    'ya_asignadas', v_ya, 'omitidas', v_omitidas, 'filas', v_filas);
end;
$function$;

-- anular_turnos_lote (previa)
CREATE OR REPLACE FUNCTION public.anular_turnos_lote(p_operacion_id uuid, p_turno_ids uuid[], p_accion text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid; v_actor record; v_zonas uuid[]; v_tid uuid; v_turno record;
  v_hoy_arg date; v_hora_arg time; v_res text; v_motivo_fila text;
  v_filas jsonb := '[]'::jsonb; v_aplicados integer := 0; v_omitidos integer := 0;
  v_estado_nuevo text; v_comentario text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id, rol into v_actor from public.usuarios
  where auth_user_id = v_uid and estado = 'activo' and rol in ('admin','supervisor');
  if not found then raise exception 'No autorizado'; end if;
  if v_actor.rol = 'supervisor' then
    select array_agg(zona_id) into v_zonas from public.supervisor_zonas where supervisor_id = v_actor.id;
  end if;
  if p_operacion_id is null then raise exception 'operacion_id requerido'; end if;
  if p_accion not in ('anular','reactivar') then raise exception 'Accion invalida'; end if;
  if p_turno_ids is null or array_length(p_turno_ids,1) is null then raise exception 'No hay turnos seleccionados'; end if;
  if array_length(p_turno_ids,1) > 100 then raise exception 'Maximo 100 turnos por operacion'; end if;
  if p_accion = 'anular' and length(trim(coalesce(p_motivo,''))) < 3 then
    raise exception 'El motivo de la anulacion es obligatorio'; end if;
  v_estado_nuevo := case when p_accion = 'anular' then 'anulado' else 'programado' end;
  v_hoy_arg  := ((now() at time zone 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() at time zone 'UTC') - interval '3 hours')::time;
  v_comentario := case when p_accion = 'anular'
    then 'Anulacion en lote desde la grilla: ' || trim(p_motivo)
    else 'Reactivacion en lote desde la grilla' end
    || ' (operacion ' || p_operacion_id::text || ')';
  foreach v_tid in array p_turno_ids loop
    v_res := 'omitido'; v_motivo_fila := null;
    begin
      select t.*, o.zona_id as objetivo_zona into v_turno
      from public.turnos t join public.objetivos o on o.id = t.objetivo_id
      where t.id = v_tid for update of t;
      if not found then raise exception 'Turno inexistente'; end if;
      if v_actor.rol = 'supervisor' and v_zonas is not null
         and not (v_turno.objetivo_zona = any (v_zonas)) then
        raise exception 'Objetivo fuera de la zona del supervisor'; end if;
      if v_turno.fecha < v_hoy_arg or (v_turno.fecha = v_hoy_arg and v_turno.hora_inicio <= v_hora_arg) then
        raise exception 'El turno ya inicio o es pasado'; end if;
      perform 1 from public.registros_asistencia r
      where r.turno_id = v_turno.id and coalesce(r.tipo_registro,'') <> 'ausencia'
        and (r.hora_entrada_real is not null or r.hora_entrada_final is not null);
      if found then raise exception 'El turno ya tiene asistencia registrada'; end if;
      if p_accion = 'anular' then
        if coalesce(v_turno.estado,'') in ('anulado','cancelado') then raise exception 'Ya estaba anulado'; end if;
        if coalesce(v_turno.estado,'') = 'reemplazado' then raise exception 'Turno reemplazado'; end if;
      else
        if coalesce(v_turno.estado,'') not in ('anulado','cancelado') then raise exception 'El turno no esta anulado'; end if;
      end if;
      update public.turnos set estado = v_estado_nuevo where id = v_turno.id;
      insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      values (v_turno.id, v_actor.id, 'estado', v_turno.estado, v_estado_nuevo, v_comentario);
      v_res := 'aplicado';
    exception when others then v_res := 'omitido'; v_motivo_fila := sqlerrm;
    end;
    if v_res = 'aplicado' then v_aplicados := v_aplicados + 1; else v_omitidos := v_omitidos + 1; end if;
    v_filas := v_filas || jsonb_build_object('turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo_fila);
  end loop;
  return jsonb_build_object('operacion_id', p_operacion_id, 'accion', p_accion,
    'solicitados', array_length(p_turno_ids,1), 'aplicados', v_aplicados,
    'omitidos', v_omitidos, 'filas', v_filas);
end;
$function$;

-- crear_turnos_posicion_objetivo (previa)
CREATE OR REPLACE FUNCTION public.crear_turnos_posicion_objetivo(p_operacion_id uuid, p_objetivo_id uuid, p_puesto_id uuid, p_hora_inicio time without time zone, p_hora_fin time without time zone, p_fechas jsonb, p_permitir_duplicado boolean DEFAULT false, p_tipo_evento text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid       uuid;
  v_actor     record;
  v_zonas     uuid[];
  v_objetivo  record;
  v_tipo      text;
  v_hash      text;
  v_previa    record;
  v_mes       text;
  v_payload   jsonb;
  v_fecha_txt text;
  v_fecha     date;
  v_hoy_arg   date;
  v_hora_arg  time;
  v_exist_id  uuid;
  v_turno_id  uuid;
  v_res       text;
  v_motivo    text;
  v_filas_out jsonb := '[]'::jsonb;
  v_creados   uuid[] := '{}';
  v_creadas   integer := 0;
  v_ya        integer := 0;
  v_omitidas  integer := 0;
  v_total     integer;
  v_resultado jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id, rol INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la programacion es de administracion o supervision';
  END IF;

  IF v_actor.rol = 'supervisor' THEN
    SELECT array_agg(zona_id) INTO v_zonas
    FROM public.supervisor_zonas WHERE supervisor_id = v_actor.id;
    -- v_zonas NULL = supervisor sin zonas = alcance total (regla existente).
  END IF;

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'operacion_id requerido';
  END IF;
  IF p_objetivo_id IS NULL OR p_puesto_id IS NULL THEN
    RAISE EXCEPTION 'Objetivo y posicion operativa requeridos';
  END IF;
  IF p_hora_inicio IS NULL OR p_hora_fin IS NULL THEN
    RAISE EXCEPTION 'Horario requerido';
  END IF;
  -- hora_fin < hora_inicio es un turno nocturno, valido. Iguales no definen duracion.
  IF p_hora_inicio = p_hora_fin THEN
    RAISE EXCEPTION 'El horario de fin no puede ser igual al de inicio';
  END IF;

  -- Misma taxonomia que el CHECK turnos_tipo_evento_check. Se valida aca para
  -- fallar con un mensaje entendible en vez de romper contra el constraint.
  v_tipo := COALESCE(NULLIF(p_tipo_evento, ''), 'normal');
  IF v_tipo NOT IN ('normal', 'cobertura', 'capacitacion') THEN
    RAISE EXCEPTION 'Caracteristica de turno invalida: %', p_tipo_evento;
  END IF;

  IF p_fechas IS NULL OR jsonb_typeof(p_fechas) <> 'array' OR jsonb_array_length(p_fechas) = 0 THEN
    RAISE EXCEPTION 'No hay fechas seleccionadas';
  END IF;
  v_total := jsonb_array_length(p_fechas);
  IF v_total > 500 THEN
    RAISE EXCEPTION 'Demasiadas fechas para una sola operacion (maximo 500)';
  END IF;

  -- Validaciones que aplican a toda la operacion: si fallan, no se crea nada.
  SELECT o.estado, o.zona_id INTO v_objetivo
  FROM public.objetivos o WHERE o.id = p_objetivo_id;
  IF NOT FOUND OR v_objetivo.estado <> 'activo' THEN
    RAISE EXCEPTION 'Objetivo inactivo';
  END IF;
  -- es_prueba no se chequea a proposito: la exclusion de objetivos de prueba
  -- aplica a la generacion masiva, no a esta accion puntual sobre un objetivo
  -- elegido a mano.
  IF v_actor.rol = 'supervisor' AND v_zonas IS NOT NULL
     AND NOT (v_objetivo.zona_id = ANY (v_zonas)) THEN
    RAISE EXCEPTION 'Objetivo fuera de la zona del supervisor';
  END IF;

  PERFORM 1 FROM public.puestos p
  WHERE p.id = p_puesto_id AND p.activo AND p.objetivo_id = p_objetivo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posicion operativa inactiva o de otro objetivo';
  END IF;

  -- Idempotencia por operacion. El lock serializa reintentos concurrentes
  -- del mismo operacion_id.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));
  v_payload := jsonb_build_object(
    'objetivo_id', p_objetivo_id,
    'puesto_id', p_puesto_id,
    'hora_inicio', p_hora_inicio::text,
    'hora_fin', p_hora_fin::text,
    'fechas', p_fechas,
    'permitir_duplicado', p_permitir_duplicado,
    'tipo_evento', v_tipo
  );
  v_hash := md5(v_payload::text);
  SELECT payload_hash, resultado INTO v_previa
  FROM public.generacion_turnos_auditoria
  WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_previa.payload_hash = v_hash THEN
      RETURN v_previa.resultado || jsonb_build_object('repetida', true);
    END IF;
    RAISE EXCEPTION 'La operacion ya fue ejecutada con otro contenido: inicia una operacion nueva';
  END IF;

  v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;

  FOR v_fecha_txt IN SELECT jsonb_array_elements_text(p_fechas) LOOP
    v_res := 'omitida';
    v_motivo := NULL;
    v_turno_id := NULL;
    v_exist_id := NULL;
    BEGIN
      v_fecha := v_fecha_txt::date;

      IF v_fecha < v_hoy_arg
         OR (v_fecha = v_hoy_arg AND p_hora_inicio <= v_hora_arg) THEN
        RAISE EXCEPTION 'Fecha pasada: los dias pasados se resuelven por regularizacion administrativa';
      END IF;

      -- Turno equivalente vigente: misma posicion, fecha, horario Y
      -- caracteristica. Con p_permitir_duplicado no se consulta: el puesto va
      -- doblado a proposito y cada fecha suma un turno mas.
      IF NOT p_permitir_duplicado THEN
        SELECT t.id INTO v_exist_id
        FROM public.turnos t
        WHERE t.objetivo_id = p_objetivo_id
          AND t.puesto_id = p_puesto_id
          AND t.fecha = v_fecha
          AND t.hora_inicio = p_hora_inicio
          AND t.hora_fin = p_hora_fin
          AND COALESCE(t.tipo_evento, 'normal') = v_tipo
          AND COALESCE(t.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
        LIMIT 1;
      END IF;

      IF v_exist_id IS NOT NULL THEN
        v_res := 'ya_existe';
        v_motivo := 'Ya hay un turno cargado para esa posicion, fecha, horario y caracteristica';
        v_turno_id := v_exist_id;
      ELSE
        INSERT INTO public.turnos (
          objetivo_id, puesto_id, servicio_base_id, fecha, hora_inicio, hora_fin,
          estado, tipo_evento, estado_revision, guardia_id, guardia_original_id, guardia_real_id
        ) VALUES (
          p_objetivo_id, p_puesto_id, NULL, v_fecha,
          p_hora_inicio, p_hora_fin,
          'programado', v_tipo, 'aprobado', NULL, NULL, NULL
        )
        RETURNING id INTO v_turno_id;
        v_res := 'creada';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_res := 'omitida';
      v_motivo := SQLERRM;
      v_turno_id := NULL;
    END;

    IF v_res = 'creada' THEN
      v_creadas := v_creadas + 1;
      v_creados := array_append(v_creados, v_turno_id);
    ELSIF v_res = 'ya_existe' THEN
      v_ya := v_ya + 1;
    ELSE
      v_omitidas := v_omitidas + 1;
    END IF;

    v_filas_out := v_filas_out || jsonb_build_object(
      'fecha', v_fecha_txt,
      'resultado', v_res,
      'motivo', v_motivo,
      'turno_id', v_turno_id
    );
  END LOOP;

  -- La auditoria indexa por mes: se toma el de la primera fecha del lote.
  v_mes := left(p_fechas->>0, 7);

  v_resultado := jsonb_build_object(
    'operacion_id', p_operacion_id,
    'solicitadas', v_total,
    'creadas', v_creadas,
    'ya_existentes', v_ya,
    'omitidas', v_omitidas,
    'tipo_evento', v_tipo,
    'turnos_creados', to_jsonb(v_creados),
    'filas', v_filas_out
  );

  INSERT INTO public.generacion_turnos_auditoria (
    operacion_id, usuario_id, auth_user_id, mes, payload, payload_hash,
    filas_solicitadas, filas_creadas, filas_ya_existentes, filas_omitidas,
    turnos_creados, resultado
  ) VALUES (
    p_operacion_id, v_actor.id, v_uid, v_mes, v_payload, v_hash,
    v_total, v_creadas, v_ya, v_omitidas,
    v_creados, v_resultado
  );

  RETURN v_resultado;
END;
$function$;

-- crear_turnos_programacion_parcial (previa)
CREATE OR REPLACE FUNCTION public.crear_turnos_programacion_parcial(p_operacion_id uuid, p_mes text, p_filas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid        uuid;
  v_actor      record;
  v_zonas      uuid[];
  v_fuera      integer;
  v_hash       text;
  v_previa     record;
  v_fila       jsonb;
  v_servicio   record;
  v_objetivo   record;
  v_tb         record;
  v_exist      record;
  v_fecha      date;
  v_desde      date;
  v_hasta      date;
  v_hoy_arg    date;
  v_hora_arg   time;
  v_dow        integer;
  v_turno_id   uuid;
  v_res        text;
  v_motivo     text;
  v_filas_out  jsonb := '[]'::jsonb;
  v_creados    uuid[] := '{}';
  v_creadas    integer := 0;
  v_ya         integer := 0;
  v_omitidas   integer := 0;
  v_resultado  jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT id, rol INTO v_actor
  FROM public.usuarios
  WHERE auth_user_id = v_uid AND estado = 'activo' AND rol IN ('admin', 'supervisor');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: la generacion de turnos es de administracion o supervision';
  END IF;

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'operacion_id requerido';
  END IF;
  IF p_mes IS NULL OR p_mes !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Mes invalido (formato esperado YYYY-MM)';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'No hay filas seleccionadas';
  END IF;
  IF jsonb_array_length(p_filas) > 500 THEN
    RAISE EXCEPTION 'Demasiadas filas para una sola operacion (maximo 500)';
  END IF;

  -- Alcance del supervisor: se valida el payload COMPLETO antes de tocar
  -- nada. Cualquier fila fuera (servicio inexistente O INACTIVO, objetivo
  -- inactivo o de prueba, zona ajena, inactiva o sin zona) lanza excepcion y
  -- revierte todo: cero creaciones parciales. No se confia en ningun dato
  -- del cliente: el objetivo y su zona se derivan del servicio en la base.
  -- Para el admin nada cambia, y las clasificaciones POR FILA del loop
  -- (fecha pasada, duplicado...) tampoco.
  IF v_actor.rol = 'supervisor' THEN
    -- Solo cuentan las zonas ACTIVAS: una asignacion a zona inactiva es
    -- equivalente a no tener la zona.
    SELECT array_agg(sz.zona_id) INTO v_zonas
    FROM public.supervisor_zonas sz
    JOIN public.zonas_operativas z ON z.id = sz.zona_id AND z.estado = 'activo'
    WHERE sz.supervisor_id = v_actor.id;
    IF v_zonas IS NULL THEN
      RAISE EXCEPTION 'No autorizado: supervisor sin zonas activas asignadas';
    END IF;

    SELECT count(*) INTO v_fuera
    FROM (
      SELECT DISTINCT (f->>'servicio_id')::uuid AS sid
      FROM jsonb_array_elements(p_filas) f
    ) x
    LEFT JOIN public.servicios_objetivo s ON s.id = x.sid
    LEFT JOIN public.objetivos o ON o.id = s.objetivo_id
    WHERE s.id IS NULL
       OR NOT s.activo
       OR o.id IS NULL
       OR o.estado <> 'activo'
       OR COALESCE(o.es_prueba, false)
       OR o.zona_id IS NULL
       OR NOT (o.zona_id = ANY (v_zonas));
    IF v_fuera > 0 THEN
      RAISE EXCEPTION 'No autorizado: % fila(s) de objetivos fuera del alcance del supervisor; no se creo ningun turno', v_fuera;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));
  v_hash := md5(p_mes || '|' || p_filas::text);
  SELECT payload_hash, resultado INTO v_previa
  FROM public.generacion_turnos_auditoria
  WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_previa.payload_hash = v_hash THEN
      RETURN v_previa.resultado || jsonb_build_object('repetida', true);
    END IF;
    RAISE EXCEPTION 'La operacion ya fue ejecutada con otro contenido: inicia una operacion nueva';
  END IF;

  v_desde := to_date(p_mes || '-01', 'YYYY-MM-DD');
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  -- Hora Argentina (UTC-3 fija, misma convención que lib/revision-operativa).
  v_hoy_arg  := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() AT TIME ZONE 'UTC') - interval '3 hours')::time;

  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    v_res := 'omitida';
    v_motivo := NULL;
    v_turno_id := NULL;
    BEGIN
      v_fecha := (v_fila->>'fecha')::date;
      IF v_fecha IS NULL THEN
        RAISE EXCEPTION 'Fila sin fecha';
      END IF;
      IF v_fecha < v_desde OR v_fecha > v_hasta THEN
        RAISE EXCEPTION 'Fecha fuera del mes de la operacion';
      END IF;

      SELECT s.id, s.objetivo_id, s.puesto_id, s.turno_base_id, s.dias_semana, s.activo
      INTO v_servicio
      FROM public.servicios_objetivo s
      WHERE s.id = (v_fila->>'servicio_id')::uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Servicio inexistente';
      END IF;
      IF NOT v_servicio.activo THEN
        RAISE EXCEPTION 'Servicio inactivo';
      END IF;

      SELECT o.estado, o.es_prueba INTO v_objetivo
      FROM public.objetivos o WHERE o.id = v_servicio.objetivo_id;
      IF NOT FOUND OR v_objetivo.estado <> 'activo' THEN
        RAISE EXCEPTION 'Objetivo inactivo';
      END IF;
      IF v_objetivo.es_prueba THEN
        RAISE EXCEPTION 'Objetivo de prueba excluido';
      END IF;

      IF v_servicio.puesto_id IS NULL THEN
        RAISE EXCEPTION 'Servicio sin puesto vinculado';
      END IF;
      PERFORM 1 FROM public.puestos p
      WHERE p.id = v_servicio.puesto_id AND p.activo AND p.objetivo_id = v_servicio.objetivo_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Puesto inactivo o de otro objetivo';
      END IF;

      SELECT tb.hora_inicio, tb.hora_fin, tb.activo INTO v_tb
      FROM public.turnos_base tb WHERE tb.id = v_servicio.turno_base_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno base inexistente';
      END IF;
      IF NOT v_tb.activo THEN
        RAISE EXCEPTION 'Turno base inactivo';
      END IF;
      IF v_tb.hora_inicio IS NULL OR v_tb.hora_fin IS NULL THEN
        RAISE EXCEPTION 'Franja horaria invalida';
      END IF;

      -- Sin creación retroactiva: fecha anterior al día de ejecución, o la
      -- de hoy cuando el turno ya comenzó.
      IF v_fecha < v_hoy_arg OR (v_fecha = v_hoy_arg AND v_tb.hora_inicio <= v_hora_arg) THEN
        RAISE EXCEPTION 'fecha_pasada';
      END IF;

      v_dow := EXTRACT(ISODOW FROM v_fecha);
      IF v_servicio.dias_semana IS NULL OR NOT (v_dow = ANY (v_servicio.dias_semana)) THEN
        RAISE EXCEPTION 'El dia no corresponde a los dias del servicio';
      END IF;

      SELECT t.id, t.servicio_base_id INTO v_exist
      FROM public.turnos t
      WHERE t.fecha = v_fecha
        AND t.hora_inicio = v_tb.hora_inicio
        AND t.hora_fin = v_tb.hora_fin
        AND t.puesto_id = v_servicio.puesto_id
        AND COALESCE(t.tipo_evento, 'normal') = 'normal'
        AND COALESCE(t.estado, '') NOT IN ('reemplazado', 'anulado', 'cancelado')
        AND (t.servicio_base_id = v_servicio.id OR t.objetivo_id = v_servicio.objetivo_id)
      ORDER BY (t.servicio_base_id = v_servicio.id) DESC
      LIMIT 1;
      IF FOUND THEN
        v_res := 'ya_existe';
        v_motivo := CASE WHEN v_exist.servicio_base_id = v_servicio.id
          THEN 'Ya generado desde este servicio'
          ELSE 'Coincide con un turno ya cargado para ese puesto y horario' END;
        v_turno_id := v_exist.id;
      ELSE
        INSERT INTO public.turnos (
          objetivo_id, puesto_id, servicio_base_id, fecha, hora_inicio, hora_fin,
          estado, tipo_evento, estado_revision, guardia_id, guardia_original_id, guardia_real_id
        ) VALUES (
          v_servicio.objetivo_id, v_servicio.puesto_id, v_servicio.id, v_fecha,
          v_tb.hora_inicio, v_tb.hora_fin,
          'programado', 'normal', 'aprobado', NULL, NULL, NULL
        )
        RETURNING id INTO v_turno_id;
        v_res := 'creada';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_res := 'omitida';
      v_motivo := SQLERRM;
      v_turno_id := NULL;
    END;

    IF v_res = 'creada' THEN
      v_creadas := v_creadas + 1;
      v_creados := array_append(v_creados, v_turno_id);
    ELSIF v_res = 'ya_existe' THEN
      v_ya := v_ya + 1;
    ELSE
      v_omitidas := v_omitidas + 1;
    END IF;

    v_filas_out := v_filas_out || jsonb_build_object(
      'servicio_id', v_fila->>'servicio_id',
      'fecha', v_fila->>'fecha',
      'resultado', v_res,
      'motivo', v_motivo,
      'turno_id', v_turno_id
    );
  END LOOP;

  v_resultado := jsonb_build_object(
    'operacion_id', p_operacion_id,
    'mes', p_mes,
    'solicitadas', jsonb_array_length(p_filas),
    'creadas', v_creadas,
    'ya_existentes', v_ya,
    'omitidas', v_omitidas,
    'turnos_creados', to_jsonb(v_creados),
    'filas', v_filas_out
  );

  INSERT INTO public.generacion_turnos_auditoria (
    operacion_id, usuario_id, auth_user_id, mes, payload, payload_hash,
    filas_solicitadas, filas_creadas, filas_ya_existentes, filas_omitidas,
    turnos_creados, resultado
  ) VALUES (
    p_operacion_id, v_actor.id, v_uid, p_mes, p_filas, v_hash,
    jsonb_array_length(p_filas), v_creadas, v_ya, v_omitidas,
    v_creados, v_resultado
  );

  RETURN v_resultado;
END;
$function$;

-- cerrar_turno (previa)
CREATE OR REPLACE FUNCTION public.cerrar_turno(p_turno_id uuid, p_tramos jsonb, p_comentario text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid                uuid;
  v_usuario_id         uuid;
  v_rol                text;
  v_turno_hora_inicio  time;
  v_turno_hora_fin     time;
  v_turno_revisado_por uuid;
  v_tramo              jsonb;
  v_guardia_id         uuid;
  v_hora_inicio        time;
  v_hora_fin           time;
  v_minutos            int;
  v_horas              numeric;
  v_registro_id        uuid;
  v_guardias_aprobados uuid[] := ARRAY[]::uuid[];
  v_rows               int;
BEGIN

  -- ── 1. Verificar sesión ──────────────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado: auth.uid() es NULL';
  END IF;

  -- ── 2. Verificar rol ─────────────────────────────────────────────────────
  SELECT id, rol
  INTO v_usuario_id, v_rol
  FROM public.usuarios
  WHERE auth_user_id = v_uid
    AND estado       = 'activo'
    AND rol          IN ('admin', 'supervisor');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin o supervisor con estado activo';
  END IF;

  -- ── 3. Bloquear y leer turno ─────────────────────────────────────────────
  SELECT hora_inicio, hora_fin, revisado_por
  INTO v_turno_hora_inicio, v_turno_hora_fin, v_turno_revisado_por
  FROM public.turnos
  WHERE id = p_turno_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno no encontrado: %', p_turno_id;
  END IF;

  -- ── 4. Supervisor no puede re-revisar (admin sí) ─────────────────────────
  IF v_turno_revisado_por IS NOT NULL AND v_rol <> 'admin' THEN
    RAISE EXCEPTION 'El turno ya fue revisado. Solo un administrador puede volver a cerrarlo.';
  END IF;

  -- ── 5. Supervisor: verificar que el turno pertenece a su zona ────────────
  IF v_rol = 'supervisor' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.turnos t2
      JOIN public.objetivos o ON o.id = t2.objetivo_id
      JOIN public.supervisor_zonas sz ON sz.zona_id = o.zona_id
      WHERE t2.id = p_turno_id
        AND sz.supervisor_id = v_usuario_id
    ) THEN
      RAISE EXCEPTION 'No autorizado: el turno no pertenece a su zona asignada';
    END IF;
  END IF;

  -- ── 6. Procesar cada tramo ───────────────────────────────────────────────
  FOR v_tramo IN SELECT * FROM jsonb_array_elements(p_tramos) LOOP

    v_guardia_id  := (v_tramo->>'guardia_id')::uuid;
    v_hora_inicio := (v_tramo->>'hora_inicio')::time;
    v_hora_fin    := (v_tramo->>'hora_fin')::time;

    IF v_guardia_id IS NULL THEN
      RAISE EXCEPTION 'Cada tramo debe tener guardia_id';
    END IF;
    IF v_hora_inicio IS NULL OR v_hora_fin IS NULL THEN
      RAISE EXCEPTION 'Cada tramo debe tener hora_inicio y hora_fin';
    END IF;
    IF v_hora_inicio = v_hora_fin THEN
      RAISE EXCEPTION 'hora_inicio y hora_fin no pueden ser iguales en el mismo tramo';
    END IF;

    -- Aritmética pura de horas (sin tolerancia GPS)
    -- Soporta turnos nocturnos: si fin < inicio → cruza medianoche
    v_minutos := (EXTRACT(EPOCH FROM v_hora_fin)::int / 60)
               - (EXTRACT(EPOCH FROM v_hora_inicio)::int / 60);
    IF v_minutos <= 0 THEN
      v_minutos := v_minutos + 1440;
    END IF;
    v_horas := ROUND(v_minutos::numeric / 60.0, 2);

    -- Acumular guardias aprobados para el paso 7
    v_guardias_aprobados := v_guardias_aprobados || v_guardia_id;

    -- Verificar que el guardia existe
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_guardia_id) THEN
      RAISE EXCEPTION 'Guardia no encontrado: %', v_guardia_id;
    END IF;

    -- Buscar registro existente para este guardia en este turno
    -- Prioridad: mismo scoring que TypeScript (horas_liquidables > _final fields > GPS > nada)
    SELECT id INTO v_registro_id
    FROM public.registros_asistencia
    WHERE turno_id = p_turno_id
      AND COALESCE(guardia_final_id, guardia_id) = v_guardia_id
      AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia')
    ORDER BY
      (CASE WHEN horas_liquidables IS NOT NULL THEN 100 ELSE 0 END) +
      (CASE WHEN hora_entrada_final IS NOT NULL OR hora_salida_final IS NOT NULL THEN 40 ELSE 0 END) +
      (CASE WHEN hora_entrada_real IS NOT NULL THEN 10 ELSE 0 END) +
      (CASE WHEN hora_salida_real IS NOT NULL THEN 5 ELSE 0 END) DESC,
      created_at ASC
    LIMIT 1;

    IF FOUND THEN
      -- Registro existente → actualizar campos _final
      UPDATE public.registros_asistencia
      SET hora_entrada_final = v_hora_inicio,
          hora_salida_final  = v_hora_fin,
          horas_liquidables  = v_horas,
          comentario_final   = p_comentario,
          origen_cobertura   = 'confirmacion_supervisor'
      WHERE id = v_registro_id;

      INSERT INTO public.registros_asistencia_auditoria
        (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      VALUES
        (v_registro_id, p_turno_id, v_usuario_id,
         'cerrar_turno', NULL, v_horas::text, p_comentario);

    ELSE
      -- Sin registro previo → crear uno nuevo
      INSERT INTO public.registros_asistencia (
        turno_id,
        guardia_id,
        hora_entrada_real,
        hora_salida_real,
        horas_trabajadas,
        horas_liquidables,
        tipo_registro,
        origen_cobertura,
        observacion
      ) VALUES (
        p_turno_id,
        v_guardia_id,
        v_hora_inicio,
        v_hora_fin,
        v_horas,
        v_horas,
        'carga_manual',
        'confirmacion_supervisor',
        p_comentario
      )
      RETURNING id INTO v_registro_id;

      INSERT INTO public.registros_asistencia_auditoria
        (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      VALUES
        (v_registro_id, p_turno_id, v_usuario_id,
         'cerrar_turno_nuevo', NULL, v_horas::text, p_comentario);
    END IF;

  END LOOP;

  -- ── 7. Invalidar registros GPS no incluidos en los tramos ────────────────
  -- Preserva hora_entrada_real / hora_salida_real (evidencia inmutable).
  -- Solo pone horas_liquidables = 0 y limpia los campos _final.
  UPDATE public.registros_asistencia
  SET horas_liquidables  = 0,
      hora_entrada_final = NULL,
      hora_salida_final  = NULL,
      comentario_final   = 'No incluido en cobertura aprobada'
  WHERE turno_id = p_turno_id
    AND (tipo_registro IS NULL OR tipo_registro <> 'ausencia')
    AND NOT (COALESCE(guardia_final_id, guardia_id) = ANY(v_guardias_aprobados))
    AND horas_liquidables IS DISTINCT FROM 0;

  -- ── 8. Marcar turno como revisado ────────────────────────────────────────
  UPDATE public.turnos
  SET revisado_por = v_usuario_id,
      revisado_at  = now(),
      -- Solo marcar cubierto si hay tramos aprobados; si no, preservar estado
      estado = CASE
                 WHEN array_length(v_guardias_aprobados, 1) > 0 THEN 'cubierto'
                 ELSE estado
               END
  WHERE id = p_turno_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'UPDATE de turnos afectó % filas para turno %; se esperaba 1',
      v_rows, p_turno_id;
  END IF;

END;
$function$;

alter policy programacion_publicaciones_select on public.programacion_publicaciones
  using ( ((EXISTS ( SELECT 1 FROM usuarios u WHERE ((u.auth_user_id = auth.uid()) AND (u.estado = 'activo'::text) AND (u.rol = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios u WHERE ((u.auth_user_id = auth.uid()) AND (u.estado = 'activo'::text) AND (u.rol = 'supervisor'::text) AND ((NOT (EXISTS ( SELECT 1 FROM supervisor_zonas sz WHERE (sz.supervisor_id = u.id)))) OR (EXISTS ( SELECT 1 FROM (supervisor_zonas sz JOIN objetivos o ON ((o.zona_id = sz.zona_id))) WHERE ((sz.supervisor_id = u.id) AND (o.id = programacion_publicaciones.objetivo_id))))))))) );
alter policy puestos_auditoria_select on public.puestos_auditoria
  using ( ((EXISTS ( SELECT 1 FROM usuarios u WHERE ((u.auth_user_id = auth.uid()) AND (u.estado = 'activo'::text) AND (u.rol = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios u WHERE ((u.auth_user_id = auth.uid()) AND (u.estado = 'activo'::text) AND (u.rol = 'supervisor'::text) AND ((NOT (EXISTS ( SELECT 1 FROM supervisor_zonas sz WHERE (sz.supervisor_id = u.id)))) OR (EXISTS ( SELECT 1 FROM (supervisor_zonas sz JOIN objetivos o ON ((o.zona_id = sz.zona_id))) WHERE ((sz.supervisor_id = u.id) AND (o.id = puestos_auditoria.objetivo_id))))))))) );

drop function if exists public.alcanza_objetivo_actual(uuid);
commit;
