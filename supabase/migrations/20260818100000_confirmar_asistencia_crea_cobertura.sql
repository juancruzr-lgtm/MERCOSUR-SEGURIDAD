-- ════════════════════════════════════════════════════════════════════
-- 20260818100000_confirmar_asistencia_crea_cobertura.sql
--
-- confirmar_asistencia pasa a MATERIALIZAR la asistencia.
--
-- Hasta acá la acción sólo dejaba la intervención registrada: la migración
-- 20260803100000 la agregó explícitamente como "NO crea registros de
-- asistencia. NO afecta liquidación. Administración decide por separado si
-- carga asistencia manual". En la práctica esa segunda mitad no ocurría nunca:
-- en agosto de 2026 hubo 14 confirmaciones de supervisor con foto verificada
-- que quedaron con 0 registros y 0 horas reconocidas — 141 h sin liquidar.
--
-- La regla nueva: si el supervisor verifica presencia y confirma, esa
-- asistencia existe y cuenta para liquidación, sin esperar que el vigilador
-- acepte Mi Planilla. El vigilador después acepta (conformidad) o solicita
-- modificación (abre revisión), pero su falta de uso de la app ya no deja el
-- turno en cero.
--
-- Reutiliza el circuito existente, sin algoritmo de horas nuevo:
--   registrar_cobertura(turno, guardia_del_turno, 'confirmacion_supervisor', …)
-- Ese origen ya estaba en la lista de valores válidos desde 20260721 —descrito
-- como "sin tiempos observados (alertas)"— y hasta ahora nadie lo usaba.
--
-- Lo que la asistencia creada por esta vía SÍ y NO hace:
--   · horas_liquidables = duración programada del turno, con nocturnos
--     resueltos por EXTRACT(EPOCH) (evita el wrap de time + interval '24h').
--   · hora_entrada_real / hora_salida_real quedan NULL: NO se inventa horario.
--   · columnas GPS y de foto intactas: NO se inventa evidencia.
--   · tipo_registro = 'carga_manual': NO se simula un fichaje del empleado.
--   · origen_cobertura = 'confirmacion_supervisor' + fila en
--     registros_asistencia_auditoria con modificado_por: trazabilidad completa.
--   · el guardia sale de turnos.guardia_id, NUNCA de un parámetro del cliente.
--   · no toca fecha ni horario programado del turno.
--
-- Todo ocurre dentro de la misma transacción de la RPC: si falla la creación
-- de la asistencia, tampoco queda la intervención. No puede pasar que el
-- sistema diga "confirmado" sin asistencia materializada.
--
-- Se reescribe la función COMPLETA a propósito. La definición viva no coincidía
-- con ningún archivo del repo: 20260803100000 la parcheaba con replace() de
-- texto sobre pg_get_functiondef(), y otra migración cambió el ORDER BY a
-- secuencia_evento. Este archivo toma la definición viva verificada el
-- 18/08/2026 y la deja explícita, para que el repo vuelva a ser la fuente.
--
-- Cambios respecto de la definición viva (todo lo demás es idéntico):
--   1. confirmar_asistencia entra en la guarda de "condición sin fichar
--      vigente": si el turno ya tiene entrada, no se crea nada.
--   2. confirmar_asistencia entra en la guarda de "alerta ya intervenida":
--      no se confirma dos veces el mismo turno.
--   3. exige guardia asignado, igual que confirmar_cubierto.
--   4. rama nueva que llama a registrar_cobertura y audita el cambio de estado.
--
-- Rollback: supabase/rollback/20260818100000_confirmar_asistencia_crea_cobertura_rollback.sql
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
  v_registro_ausencia_id uuid;
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

  if p_accion not in ('comentario', 'reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'alerta_revisada', 'reapertura', 'confirmar_asistencia', 'ausente') then
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

  -- El comentario deja de ser opcional en las decisiones de sin_fichar: el
  -- supervisor no puede cerrar una alerta sin decir qué pasó.
  if p_accion in ('comentario', 'alerta_revisada', 'confirmar_asistencia', 'ausente') and nullif(btrim(p_comentario), '') is null then
    raise exception 'El comentario es obligatorio para esta acción';
  end if;

  if p_accion = 'ausente' and p_tipo_alerta <> 'sin_fichar' then
    raise exception 'Marcar ausente solo corresponde a alertas de tipo sin fichar';
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

  -- CAMBIO 1 y 3: confirmar_asistencia ahora crea asistencia, así que queda
  -- sujeta a las mismas guardas que el resto de las acciones con efecto.
  if p_accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'confirmar_asistencia', 'ausente')
     and coalesce(v_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    raise exception 'El turno ya no admite mutaciones operativas por su estado: %', v_turno.estado;
  end if;

  if p_tipo_alerta = 'sin_fichar'
     and p_accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'confirmar_asistencia', 'ausente')
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

  -- CAMBIO 2: confirmar_asistencia entra en la guarda de doble intervención,
  -- en los dos sentidos: no se confirma dos veces, y no se confirma sobre una
  -- alerta que ya se resolvió por otra vía.
  if (
    p_accion in ('marcado_descubierto', 'confirmar_cubierto', 'alerta_revisada', 'confirmar_asistencia', 'ausente')
    or (p_accion = 'reasignacion' and p_tipo_alerta = 'descubierto')
  ) and v_ultima_accion in (
    'reasignacion', 'marcado_descubierto', 'confirmar_cubierto',
    'marcado_cubierto_manual', 'alerta_revisada', 'confirmar_asistencia', 'ausente'
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

  -- CAMBIO 3: el guardia sale del turno. Un turno sin guardia asignado es un
  -- puesto descubierto: no hay a nombre de quién confirmar asistencia.
  if p_accion in ('confirmar_asistencia', 'ausente') and v_turno.guardia_id is null then
    raise exception 'No se puede resolver la asistencia sin guardia asignado al turno';
  end if;

  -- Una sola ausencia por turno. Si ya existe, la decisión ya se tomó.
  if p_accion = 'ausente' and exists (
    select 1 from public.registros_asistencia r
    where r.turno_id = p_turno_id and r.tipo_registro = 'ausencia'
  ) then
    raise exception 'El turno ya tiene una ausencia registrada';
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
  -- CAMBIO 4: la rama que materializa la asistencia confirmada por supervisor.
  -- Mismo circuito que confirmar_cubierto, con dos diferencias deliberadas:
  -- el origen distingue quién confirmó ('confirmacion_supervisor'), y no exige
  -- rol admin ni confirmación reforzada, porque verificar presencia en el
  -- puesto es justamente la tarea del supervisor.
  -- Los cuatro NULL son la garantía de que no se inventa nada: sin hora de
  -- entrada, sin hora de salida, sin horas explícitas —se usa la duración
  -- programada— y sin tocar GPS ni fotos.
  elsif p_accion = 'confirmar_asistencia' then
    select public.registrar_cobertura(
      v_turno.id,
      v_turno.guardia_id,
      'confirmacion_supervisor',
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
      coalesce(nullif(btrim(p_comentario), ''), 'Asistencia confirmada por supervisor desde Revisión Operativa')
    );
  -- AUSENTE: el vigilador asignado debía presentarse y faltó.
  --
  -- Se escribe en registros_asistencia con tipo_registro='ausencia', que es el
  -- valor que el CHECK admite desde 20260630 y que TODO el sistema ya excluye
  -- del cálculo de horas —selectRegistroPrincipal, el universo de reportes,
  -- registrar_cobertura—. Por eso no hace falta un sistema de ausencias nuevo:
  -- la pieza estaba, sólo que nada la escribía.
  --
  -- No se usa registrar_cobertura acá a propósito: esa función crea cobertura
  -- liquidable, y una ausencia es exactamente lo contrario. Cero horas, sin
  -- entrada, sin salida, sin GPS. El comentario del supervisor va a
  -- `observacion`; el supervisor y la fecha/hora quedan en la auditoría, que
  -- es de donde los lee Mi Planilla sin necesidad de columnas nuevas.
  --
  -- turnos.estado='ausente' cierra la alerta sin sacar el turno del universo
  -- de horas programadas: 'ausente' NO está en ESTADOS_SIN_OBLIGACION, así que
  -- si nadie cubre el puesto sigue explicando la diferencia pendiente.
  elsif p_accion = 'ausente' then
    insert into public.registros_asistencia (
      turno_id, guardia_id, tipo_registro,
      horas_trabajadas, horas_liquidables, observacion
    ) values (
      v_turno.id, v_turno.guardia_id, 'ausencia',
      0, 0, nullif(btrim(p_comentario), '')
    )
    returning id into v_registro_ausencia_id;

    insert into public.registros_asistencia_auditoria (
      registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_registro_ausencia_id, v_turno.id, v_usuario.id,
      'ausencia_supervisor', null, 'ausente', nullif(btrim(p_comentario), '')
    );

    v_estado_nuevo := 'ausente';
    update public.turnos set estado = 'ausente' where id = v_turno.id;

    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'estado', v_turno.estado, 'ausente',
      coalesce(nullif(btrim(p_comentario), ''), 'Ausencia registrada por supervisor desde Revisión Operativa')
    );
  end if;

  if p_accion = 'reapertura' then
    select si.id
      into v_reapertura_de_id
    from public.supervisor_intervenciones si
    where si.turno_id = p_turno_id
      and si.tipo_alerta = p_tipo_alerta
      and si.accion in ('reasignacion', 'marcado_descubierto', 'confirmar_cubierto', 'marcado_cubierto_manual', 'alerta_revisada', 'confirmar_asistencia')
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
    'registro_cobertura_id', v_registro_cobertura_id,
    'registro_ausencia_id', v_registro_ausencia_id
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
    -- La asistencia recién creada queda enlazada desde la intervención: es lo
    -- que permite ir de "quién confirmó" a "qué registro se creó" sin heurística.
    coalesce(p_registro_asistencia_id, v_registro_cobertura_id, v_registro_ausencia_id),
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
