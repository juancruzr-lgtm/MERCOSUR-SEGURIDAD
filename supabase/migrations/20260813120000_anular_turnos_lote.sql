-- Anulación y reactivación de turnos en lote desde la grilla
--
-- CAUSA
-- Anular era de a un turno: la grilla llamaba a /api/turnos/editar, que acepta
-- un único turno_id. Para dar de baja la programación de un vigilador hasta fin
-- de mes había que repetir la operación día por día.
--
-- POR QUÉ UNA RPC Y NO N LLAMADAS AL ENDPOINT
--   · N viajes de red para una sola decisión del usuario;
--   · sin atomicidad por turno ni resultado agregado;
--   · /api/turnos/editar NO valida la zona del supervisor —hueco preexistente—,
--     así que construir la operación masiva encima lo habría multiplicado.
--
-- Esta función es el espejo exacto de asignar_vigilador_turnos: mismo tope de
-- 100, misma validación por turno sin abortar el lote, misma auditoría por
-- turno y mismo formato de resultado detallado. No se inventa un patrón nuevo.
--
-- REGLAS
-- No define qué turno se puede anular: aplica las mismas que ya rigen la celda
-- suelta.
--   · sólo turnos futuros o no iniciados (hora Argentina UTC-3);
--   · nunca uno con asistencia registrada;
--   · 'reemplazado' no se reactiva: existe otro turno que lo sustituye y
--     revivirlo dejaría el objetivo cubierto dos veces;
--   · anular exige motivo; reactivar no, porque deshacer no destruye nada.
--
-- Aditiva y reversible (DROP FUNCTION). No modifica datos por sí sola.

create or replace function public.anular_turnos_lote(
  p_operacion_id uuid,
  p_turno_ids    uuid[],
  p_accion       text,
  p_motivo       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $BODY$
declare
  v_uid        uuid;
  v_actor      record;
  v_zonas      uuid[];
  v_tid        uuid;
  v_turno      record;
  v_hoy_arg    date;
  v_hora_arg   time;
  v_res        text;
  v_motivo_fila text;
  v_filas      jsonb := '[]'::jsonb;
  v_aplicados  integer := 0;
  v_omitidos   integer := 0;
  v_estado_nuevo text;
  v_comentario text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'No autenticado'; end if;

  select id, rol into v_actor from public.usuarios
  where auth_user_id = v_uid and estado = 'activo' and rol in ('admin','supervisor');
  if not found then
    raise exception 'No autorizado: la operacion es de administracion o supervision';
  end if;

  if v_actor.rol = 'supervisor' then
    select array_agg(zona_id) into v_zonas
    from public.supervisor_zonas where supervisor_id = v_actor.id;
    -- v_zonas NULL = supervisor sin zonas = alcance total (regla existente).
  end if;

  if p_operacion_id is null then raise exception 'operacion_id requerido'; end if;
  if p_accion not in ('anular','reactivar') then raise exception 'Accion invalida'; end if;
  if p_turno_ids is null or array_length(p_turno_ids,1) is null then
    raise exception 'No hay turnos seleccionados';
  end if;
  if array_length(p_turno_ids,1) > 100 then
    raise exception 'Demasiados turnos para una sola operacion (maximo 100)';
  end if;
  if p_accion = 'anular' and length(trim(coalesce(p_motivo,''))) < 3 then
    raise exception 'El motivo de la anulacion es obligatorio';
  end if;

  v_estado_nuevo := case when p_accion = 'anular' then 'anulado' else 'programado' end;
  v_hoy_arg  := ((now() at time zone 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() at time zone 'UTC') - interval '3 hours')::time;
  v_comentario := case when p_accion = 'anular'
    then 'Anulacion en lote desde la grilla: ' || trim(p_motivo)
    else 'Reactivacion en lote desde la grilla' end
    || ' (operacion ' || p_operacion_id::text || ')';

  foreach v_tid in array p_turno_ids loop
    v_res := 'omitido';
    v_motivo_fila := null;
    begin
      select t.*, o.zona_id as objetivo_zona
      into v_turno
      from public.turnos t
      join public.objetivos o on o.id = t.objetivo_id
      where t.id = v_tid
      for update of t;
      if not found then raise exception 'Turno inexistente'; end if;

      if v_actor.rol = 'supervisor' and v_zonas is not null
         and not (v_turno.objetivo_zona = any (v_zonas)) then
        raise exception 'Objetivo fuera de la zona del supervisor';
      end if;

      if v_turno.fecha < v_hoy_arg
         or (v_turno.fecha = v_hoy_arg and v_turno.hora_inicio <= v_hora_arg) then
        raise exception 'El turno ya inicio o es pasado';
      end if;

      -- Un turno con asistencia ya registrada no se toca desde acá: se resuelve
      -- por revision de planilla, que es donde vive esa decision.
      perform 1 from public.registros_asistencia r
      where r.turno_id = v_turno.id and coalesce(r.tipo_registro,'') <> 'ausencia'
        and (r.hora_entrada_real is not null or r.hora_entrada_final is not null);
      if found then raise exception 'El turno ya tiene asistencia registrada'; end if;

      if p_accion = 'anular' then
        if coalesce(v_turno.estado,'') in ('anulado','cancelado') then
          raise exception 'Ya estaba anulado';
        end if;
        if coalesce(v_turno.estado,'') = 'reemplazado' then
          raise exception 'Turno reemplazado: no se anula desde la grilla';
        end if;
      else
        if coalesce(v_turno.estado,'') not in ('anulado','cancelado') then
          raise exception 'El turno no esta anulado';
        end if;
      end if;

      update public.turnos set estado = v_estado_nuevo where id = v_turno.id;

      insert into public.turnos_auditoria
        (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
      values
        (v_turno.id, v_actor.id, 'estado', v_turno.estado, v_estado_nuevo, v_comentario);

      v_res := 'aplicado';
    exception when others then
      v_res := 'omitido';
      v_motivo_fila := sqlerrm;
    end;

    if v_res = 'aplicado' then v_aplicados := v_aplicados + 1;
    else v_omitidos := v_omitidos + 1; end if;

    v_filas := v_filas || jsonb_build_object(
      'turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo_fila);
  end loop;

  return jsonb_build_object(
    'operacion_id', p_operacion_id,
    'accion', p_accion,
    'solicitados', array_length(p_turno_ids,1),
    'aplicados', v_aplicados,
    'omitidos', v_omitidos,
    'filas', v_filas
  );
end;
$BODY$;

revoke all on function public.anular_turnos_lote(uuid, uuid[], text, text) from public, anon;
grant execute on function public.anular_turnos_lote(uuid, uuid[], text, text) to authenticated;

comment on function public.anular_turnos_lote(uuid, uuid[], text, text) is
  'Anula o reactiva turnos en lote desde la grilla. Valida turno por turno sin '
  'abortar la operacion, respeta la zona del supervisor, exige motivo para anular '
  'y deja una fila por turno en turnos_auditoria. Espejo de asignar_vigilador_turnos.';

notify pgrst, 'reload schema';
