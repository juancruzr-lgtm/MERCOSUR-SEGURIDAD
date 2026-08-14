-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK de 20260818100000_confirmar_asistencia_crea_cobertura.sql
--
-- Restaura registrar_intervencion_operativa a la definición que estaba viva en
-- producción al 18/08/2026 (verificada con pg_get_functiondef antes del fix).
-- Con esto confirmar_asistencia vuelve a registrar sólo la intervención, sin
-- crear asistencia.
--
-- QUÉ NO REVIERTE ESTE ARCHIVO:
--   Las asistencias ya creadas por confirmar_asistencia después del fix. Son
--   filas en registros_asistencia con origen_cobertura = 'confirmacion_supervisor'
--   y horas liquidables reales. Para darlas de baja hay que usar el circuito de
--   anulación existente (cobertura_anulada_at / registro_anulado_at), nunca un
--   DELETE: borrarlas perdería la traza de que un supervisor las confirmó.
--
--   Para ubicarlas:
--     select r.id, r.turno_id, r.horas_liquidables, r.observacion, r.created_at
--     from public.registros_asistencia r
--     where r.origen_cobertura = 'confirmacion_supervisor'
--     order by r.created_at desc;
--
-- NO ejecutar junto con la migración. Este archivo se corre solo, y sólo si hay
-- que volver atrás.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_intervencion_operativa(
  p_operacion_id uuid,
  p_turno_id uuid,
  p_tipo_alerta text,
  p_accion text,
  p_registro_asistencia_id uuid DEFAULT NULL::uuid,
  p_comentario text DEFAULT NULL::text,
  p_motivo text DEFAULT NULL::text,
  p_guardia_nuevo_id uuid DEFAULT NULL::uuid,
  p_confirmacion_reforzada boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_usuario public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_existente public.supervisor_intervenciones%rowtype;
  v_intervencion_id uuid;
  v_reapertura_de_id uuid;
  v_registro_cobertura_id uuid;
  v_estado_nuevo text;
  v_guardia_anterior_id uuid;
  v_guardia_resultante_id uuid;
  v_zona text;
  v_solicitud_json jsonb;
  v_resultado_json jsonb;
  v_ultima_accion text;
begin
  if p_operacion_id is null then
    raise exception 'p_operacion_id es obligatorio';
  end if;

  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select u.*
    into v_usuario
  from public.usuarios u
  where u.auth_user_id = v_uid
    and u.estado = 'activo'
    and u.rol in ('admin', 'supervisor')
  limit 1;

  if not found then
    raise exception 'No autorizado: se requiere admin o supervisor activo';
  end if;

  v_solicitud_json := jsonb_build_object(
    'turno_id', p_turno_id,
    'tipo_alerta', p_tipo_alerta,
    'accion', p_accion,
    'registro_asistencia_id', p_registro_asistencia_id,
    'comentario', nullif(btrim(p_comentario), ''),
    'motivo', nullif(btrim(p_motivo), ''),
    'guardia_nuevo_id', p_guardia_nuevo_id,
    'confirmacion_reforzada', p_confirmacion_reforzada
  );

  select t.*
    into v_turno
  from public.turnos t
  where t.id = p_turno_id
  for update;

  if not found then
    raise exception 'Turno no encontrado';
  end if;

  if not public.puede_administrar_rondas_objetivo(v_turno.objetivo_id) then
    raise exception 'No autorizado para intervenir este objetivo';
  end if;

  select si.*
    into v_existente
  from public.supervisor_intervenciones si
  where si.operacion_id = p_operacion_id;

  if found then
    if v_existente.supervisor_id is distinct from v_usuario.id
       or v_existente.solicitud_json is distinct from v_solicitud_json then
      raise exception 'operacion_id ya utilizado con otro contexto';
    end if;

    return coalesce(
      v_existente.resultado_json,
      jsonb_build_object(
        'estado', 'aplicada',
        'intervencion_id', v_existente.id,
        'turno_id', v_existente.turno_id,
        'registro_cobertura_id', null
      )
    );
  end if;

  if p_tipo_alerta not in ('sin_fichar', 'tardanza', 'fuera_radio', 'descubierto', 'salida_pendiente') then
    raise exception 'Tipo de alerta no permitido: %', p_tipo_alerta;
  end if;

  if p_accion not in ('comentario', 'reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'alerta_revisada', 'reapertura', 'confirmar_asistencia') then
    raise exception 'Acción no permitida: %', p_accion;
  end if;

  if p_tipo_alerta in ('tardanza', 'fuera_radio') then
    if p_registro_asistencia_id is null or not exists (
      select 1 from public.registros_asistencia r
      where r.id = p_registro_asistencia_id and r.turno_id = p_turno_id
    ) then
      raise exception 'La ocurrencia requiere un registro de asistencia válido del turno';
    end if;
  elsif p_registro_asistencia_id is not null and not exists (
    select 1 from public.registros_asistencia r
    where r.id = p_registro_asistencia_id and r.turno_id = p_turno_id
  ) then
    raise exception 'El registro de asistencia no pertenece al turno';
  end if;

  if p_accion in ('comentario', 'alerta_revisada', 'confirmar_asistencia') and nullif(btrim(p_comentario), '') is null then
    raise exception 'El comentario es obligatorio para esta acción';
  end if;

  if p_accion = 'reapertura' and nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de reapertura es obligatorio';
  end if;

  if p_accion = 'reasignacion' and p_tipo_alerta not in ('sin_fichar', 'descubierto') then
    raise exception 'La reasignación no corresponde a este tipo de alerta';
  end if;

  if p_accion = 'marcado_descubierto' and p_tipo_alerta not in ('sin_fichar', 'descubierto') then
    raise exception 'Marcar descubierto no corresponde a este tipo de alerta';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta not in ('tardanza', 'fuera_radio') then
    raise exception 'Atender/justificar no corresponde a este tipo de alerta';
  end if;

  if p_accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto')
     and coalesce(v_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    raise exception 'El turno ya no admite mutaciones operativas por su estado: %', v_turno.estado;
  end if;

  if p_tipo_alerta = 'sin_fichar'
     and p_accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto')
     and exists (
       select 1
       from public.registros_asistencia r
       where r.turno_id = p_turno_id
         and (r.tipo_registro is null or r.tipo_registro <> 'ausencia')
         and coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null
     ) then
    raise exception 'La condición sin fichar ya no está vigente';
  end if;

  if p_tipo_alerta = 'descubierto'
     and p_accion in ('reasignacion', 'marcado_descubierto')
     and v_turno.guardia_id is not null then
    raise exception 'La condición de turno descubierto ya no está vigente';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta = 'tardanza'
     and not exists (
       select 1
       from public.registros_asistencia r
       where r.id = p_registro_asistencia_id
         and r.turno_id = p_turno_id
         and (
           r.alerta_entrada = 'tarde'
           or coalesce(r.hora_entrada_final, r.hora_entrada_real) > v_turno.hora_inicio
         )
     ) then
    raise exception 'La condición de tardanza ya no está vigente';
  end if;

  if p_accion = 'confirmar_asistencia' and p_tipo_alerta <> 'sin_fichar' then
    raise exception 'Confirmar asistencia solo corresponde a alertas de tipo sin fichar';
  end if;

  if p_accion = 'alerta_revisada' and p_tipo_alerta = 'fuera_radio'
     and not exists (
       select 1
       from public.registros_asistencia r
       where r.id = p_registro_asistencia_id
         and r.turno_id = p_turno_id
         and r.gps_ingreso_estado = 'fuera_radio'
     ) then
    raise exception 'La condición GPS fuera de radio ya no está vigente';
  end if;

  select si.accion
    into v_ultima_accion
  from public.supervisor_intervenciones si
  where si.turno_id = p_turno_id
    and si.tipo_alerta = p_tipo_alerta
    and si.accion <> 'comentario'
    and (
      p_tipo_alerta not in ('tardanza', 'fuera_radio')
      or si.registro_asistencia_id is not distinct from p_registro_asistencia_id
    )
  order by si.secuencia_evento desc
  limit 1;

  if (
    p_accion in ('marcado_descubierto', 'confirmar_cubierto', 'alerta_revisada')
    or (p_accion = 'reasignacion' and p_tipo_alerta = 'descubierto')
  ) and v_ultima_accion in (
    'reasignacion', 'marcado_descubierto', 'confirmar_cubierto',
    'marcado_cubierto_manual', 'alerta_revisada'
  ) then
    raise exception 'La alerta ya fue intervenida; recargue el estado antes de operar';
  end if;

  if p_accion = 'confirmar_cubierto' then
    if v_usuario.rol <> 'admin' then
      raise exception 'La cobertura manual completa está reservada a administración';
    end if;
    if p_tipo_alerta <> 'sin_fichar' then
      raise exception 'La cobertura manual no corresponde a este tipo de alerta';
    end if;
    if not p_confirmacion_reforzada then
      raise exception 'Falta la confirmación reforzada de impacto liquidable';
    end if;
    if v_turno.guardia_id is null then
      raise exception 'No se puede registrar cobertura sin guardia asignado';
    end if;
  end if;

  v_estado_nuevo := v_turno.estado;
  v_guardia_anterior_id := v_turno.guardia_id;
  v_guardia_resultante_id := v_turno.guardia_id;

  if p_accion = 'reasignacion' then
    if p_guardia_nuevo_id is null or p_guardia_nuevo_id = v_turno.guardia_id then
      raise exception 'Debe seleccionar un guardia nuevo y distinto';
    end if;
    if not exists (
      select 1 from public.usuarios u
      where u.id = p_guardia_nuevo_id and u.estado = 'activo' and u.rol in ('guardia', 'vigilador')
    ) then
      raise exception 'El guardia seleccionado no está activo o no tiene rol guardia';
    end if;
    if exists (
      select 1
      from public.turnos otro
      where otro.id <> v_turno.id
        and otro.guardia_id = p_guardia_nuevo_id
        and coalesce(otro.estado, 'programado') not in ('cancelado', 'reemplazado', 'anulado')
        and tsrange(
          otro.fecha + otro.hora_inicio,
          otro.fecha + otro.hora_fin + case when otro.hora_fin <= otro.hora_inicio then interval '1 day' else interval '0 day' end,
          '[)'
        ) && tsrange(
          v_turno.fecha + v_turno.hora_inicio,
          v_turno.fecha + v_turno.hora_fin + case when v_turno.hora_fin <= v_turno.hora_inicio then interval '1 day' else interval '0 day' end,
          '[)'
        )
    ) then
      raise exception 'El guardia ya tiene un turno superpuesto';
    end if;

    v_estado_nuevo := case when v_turno.estado = 'descubierto' then 'programado' else v_turno.estado end;
    v_guardia_resultante_id := p_guardia_nuevo_id;
    update public.turnos
       set guardia_id = p_guardia_nuevo_id,
           guardia_original_id = coalesce(guardia_original_id, v_turno.guardia_id, p_guardia_nuevo_id),
           estado = v_estado_nuevo
     where id = v_turno.id;
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'guardia_id',
      v_turno.guardia_id::text, p_guardia_nuevo_id::text,
      coalesce(nullif(btrim(p_comentario), ''), 'Reasignación desde Revisión Operativa')
    );
    if v_turno.estado is distinct from v_estado_nuevo then
      insert into public.turnos_auditoria (
        turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
      ) values (
        v_turno.id, v_usuario.id, 'estado', v_turno.estado, v_estado_nuevo,
        'Cambio derivado de reasignación en Revisión Operativa'
      );
    end if;
  elsif p_accion = 'marcado_descubierto' then
    v_estado_nuevo := 'descubierto';
    v_guardia_resultante_id := null;
    update public.turnos
       set guardia_original_id = coalesce(guardia_original_id, guardia_id),
           guardia_id = null,
           estado = 'descubierto'
     where id = v_turno.id;
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values
      (
        v_turno.id, v_usuario.id, 'guardia_id', v_turno.guardia_id::text, null,
        coalesce(nullif(btrim(p_comentario), ''), 'Marcado descubierto desde Revisión Operativa')
      ),
      (
        v_turno.id, v_usuario.id, 'estado', v_turno.estado, 'descubierto',
        coalesce(nullif(btrim(p_comentario), ''), 'Marcado descubierto desde Revisión Operativa')
      );
  elsif p_accion = 'confirmar_cubierto' then
    select public.registrar_cobertura(
      v_turno.id,
      v_turno.guardia_id,
      'confirmacion_admin',
      null,
      null,
      null,
      p_comentario
    ) into v_registro_cobertura_id;
    v_estado_nuevo := 'cubierto';
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'estado', v_turno.estado, 'cubierto',
      coalesce(nullif(btrim(p_comentario), ''), 'Cobertura manual completa desde Revisión Operativa')
    );
  end if;

  if p_accion = 'reapertura' then
    select si.id
      into v_reapertura_de_id
    from public.supervisor_intervenciones si
    where si.turno_id = p_turno_id
      and si.tipo_alerta = p_tipo_alerta
      and si.accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'marcado_cubierto_manual', 'alerta_revisada')
      and (
        p_tipo_alerta not in ('tardanza', 'fuera_radio')
        or si.registro_asistencia_id is not distinct from p_registro_asistencia_id
      )
    order by si.secuencia_evento desc
    limit 1;

    if v_reapertura_de_id is null then
      raise exception 'No existe una intervención previa para reabrir';
    end if;
  end if;

  select z.nombre
    into v_zona
  from public.objetivos o
  left join public.zonas_operativas z on z.id = o.zona_id
  where o.id = v_turno.objetivo_id;

  v_intervencion_id := gen_random_uuid();
  v_resultado_json := jsonb_build_object(
    'estado', 'aplicada',
    'intervencion_id', v_intervencion_id,
    'turno_id', p_turno_id,
    'registro_cobertura_id', v_registro_cobertura_id
  );

  insert into public.supervisor_intervenciones (
    id,
    operacion_id,
    turno_id,
    registro_asistencia_id,
    supervisor_id,
    supervisor_intervino_id,
    tipo_alerta,
    accion,
    comentario,
    motivo,
    guardia_anterior_id,
    guardia_nuevo_id,
    estado_anterior,
    estado_nuevo,
    zona,
    reapertura_de_id,
    solicitud_json,
    resultado_json
  ) values (
    v_intervencion_id,
    p_operacion_id,
    p_turno_id,
    p_registro_asistencia_id,
    v_usuario.id,
    v_usuario.id,
    p_tipo_alerta,
    p_accion,
    nullif(btrim(p_comentario), ''),
    nullif(btrim(p_motivo), ''),
    v_guardia_anterior_id,
    v_guardia_resultante_id,
    v_turno.estado,
    v_estado_nuevo,
    v_zona,
    v_reapertura_de_id,
    v_solicitud_json,
    v_resultado_json
  );
  return v_resultado_json;
exception
  when unique_violation then
    select si.* into v_existente
    from public.supervisor_intervenciones si
    where si.operacion_id = p_operacion_id;

    if found and v_existente.supervisor_id = v_usuario.id
       and v_existente.solicitud_json = v_solicitud_json then
      return coalesce(
        v_existente.resultado_json,
        jsonb_build_object(
          'estado', 'aplicada',
          'intervencion_id', v_existente.id,
          'turno_id', v_existente.turno_id,
          'registro_cobertura_id', null
        )
      );
    end if;
    raise;
end;
$function$;
