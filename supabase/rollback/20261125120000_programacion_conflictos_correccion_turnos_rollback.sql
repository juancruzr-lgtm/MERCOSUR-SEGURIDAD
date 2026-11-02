-- ROLLBACK de 20261125120000_programacion_conflictos_correccion_turnos.sql
-- Restaura asignar_vigilador_turnos a la versión previa (20260908130000), quita
-- las RPC nuevas y el trigger de alta. rondas_ventanas_programadas no se toca:
-- esta migración no la modifica (la maneja 20261122120000). Las tablas de
-- constancia NO se borran (conservan historial de auditoría); quedan sin escritura.
begin;

drop trigger if exists trg_turnos_auditar_alta on public.turnos;
drop function if exists public.turnos_auditar_alta();
drop function if exists public.corregir_turno_programacion(uuid, uuid, text, text, time, time, timestamptz, boolean);
drop function if exists public.evidencia_turno(uuid);
drop function if exists public.conflictos_turno_vigilador(uuid, uuid, time, time);
drop function if exists public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean, boolean, text);

-- asignar_vigilador_turnos (versión de 20260908130000)
CREATE OR REPLACE FUNCTION public.asignar_vigilador_turnos(p_operacion_id uuid, p_guardia_id uuid, p_turno_ids uuid[], p_masiva boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid; v_actor record; v_zonas uuid[];
  v_alcance   text; v_guardia record; v_tid uuid; v_turno record;
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
  v_alcance := public.alcance_operativo_de(v_actor.id);
  if v_alcance = 'zonas_asignadas' then
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
      if v_alcance = 'zonas_asignadas' AND NOT (v_turno.objetivo_zona = ANY (COALESCE(v_zonas, '{}'::uuid[]))) then
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

revoke all on function public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean) to authenticated;

drop function if exists public.conflictos_turno_vigilador_core(uuid, date, time, time, uuid, uuid);
notify pgrst, 'reload schema';
commit;
