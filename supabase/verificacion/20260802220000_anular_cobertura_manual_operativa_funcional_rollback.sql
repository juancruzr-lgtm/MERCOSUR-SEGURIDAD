-- Pruebas funcionales de anulación. Requiere aplicar ambas migraciones en QA.
-- Todos los fixtures y cambios se eliminan con el ROLLBACK final.

begin;

do $$
declare
  v_admin public.usuarios%rowtype;
  v_supervisor public.usuarios%rowtype;
  v_guardia public.usuarios%rowtype;
  v_zona uuid := gen_random_uuid();
  v_objetivo uuid := gen_random_uuid();
  v_turno uuid := gen_random_uuid();
  v_turno_rollback uuid := gen_random_uuid();
  v_turno_terminal uuid;
  v_operacion_cobertura uuid := gen_random_uuid();
  v_operacion_anulacion uuid := gen_random_uuid();
  v_intervencion_origen uuid;
  v_registro uuid;
  v_resultado_1 jsonb;
  v_resultado_2 jsonb;
  v_denegado boolean;
  v_estado text;
begin
  select * into v_admin from public.usuarios
  where rol = 'admin' and estado = 'activo' and auth_user_id is not null
  order by created_at limit 1;
  select * into v_supervisor from public.usuarios
  where rol = 'supervisor' and estado = 'activo' and auth_user_id is not null
  order by created_at limit 1;
  select * into v_guardia from public.usuarios
  where rol in ('guardia', 'vigilador') and estado = 'activo'
  order by created_at limit 1;
  if v_admin.id is null or v_supervisor.id is null or v_guardia.id is null then
    raise exception 'Prerequisito: admin, supervisor y guardia activos';
  end if;

  insert into public.zonas_operativas (id, nombre, estado)
  values (v_zona, 'ANULACION TEST ' || v_zona, 'activo');
  insert into public.objetivos (id, nombre, cliente, estado, zona_id)
  values (v_objetivo, 'Objetivo anulación', 'TEST ROLLBACK', 'activo', v_zona);
  insert into public.supervisor_zonas (supervisor_id, zona_id)
  values (v_supervisor.id, v_zona) on conflict do nothing;
  insert into public.turnos (id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado)
  values
    (v_turno, v_guardia.id, v_objetivo, date '2099-02-01', '22:00', '06:00', 'programado'),
    (v_turno_rollback, v_guardia.id, v_objetivo, date '2099-02-02', '22:00', '06:00', 'programado');

  perform set_config('request.jwt.claim.sub', v_admin.auth_user_id::text, true);
  select public.registrar_intervencion_operativa(
    v_operacion_cobertura, v_turno, 'sin_fichar', 'confirmar_cubierto',
    null, 'Cobertura nocturna de prueba', 'Confirmación reforzada', null, true
  ) into v_resultado_1;
  v_intervencion_origen := (v_resultado_1 ->> 'intervencion_id')::uuid;
  v_registro := (v_resultado_1 ->> 'registro_cobertura_id')::uuid;

  if (select horas_liquidables from public.registros_asistencia where id = v_registro) <> 8 then
    raise exception 'FAIL turno nocturno: la cobertura no asignó 8 horas';
  end if;

  -- Supervisor no puede anular aunque administre la zona.
  perform set_config('request.jwt.claim.sub', v_supervisor.auth_user_id::text, true);
  v_denegado := false;
  begin
    perform public.anular_cobertura_manual_operativa(gen_random_uuid(), v_intervencion_origen, 'Intento supervisor');
  exception when others then v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL supervisor pudo anular cobertura'; end if;

  -- Admin anula: conserva fila, pone horas en cero, guarda actor/motivo/origen.
  perform set_config('request.jwt.claim.sub', v_admin.auth_user_id::text, true);
  select public.anular_cobertura_manual_operativa(
    v_operacion_anulacion, v_intervencion_origen, 'Carga realizada por error'
  ) into v_resultado_1;

  if not exists (
    select 1 from public.registros_asistencia
    where id = v_registro
      and cobertura_anulada_at is not null
      and cobertura_anulada_por = v_admin.id
      and cobertura_anulada_motivo = 'Carga realizada por error'
      and cobertura_intervencion_origen_id = v_intervencion_origen
      and horas_liquidables_antes_anulacion = 8
      and horas_liquidables = 0
  ) then raise exception 'FAIL anulación: estado o trazabilidad incompletos'; end if;
  if not exists (select 1 from public.registros_asistencia where id = v_registro) then
    raise exception 'FAIL anulación: borró el registro original';
  end if;
  if not exists (
    select 1 from public.supervisor_intervenciones
    where id = (v_resultado_1 ->> 'intervencion_id')::uuid
      and accion = 'anulacion_cobertura'
      and cobertura_origen_intervencion_id = v_intervencion_origen
  ) then raise exception 'FAIL anulación: no creó evento vinculado'; end if;
  select estado into v_estado from public.turnos where id = v_turno;
  if v_estado <> 'programado' then raise exception 'FAIL anulación: turno quedó %', v_estado; end if;

  -- Idempotencia exacta y rechazo de payload diferente.
  select public.anular_cobertura_manual_operativa(
    v_operacion_anulacion, v_intervencion_origen, 'Carga realizada por error'
  ) into v_resultado_2;
  if v_resultado_1 is distinct from v_resultado_2 then
    raise exception 'FAIL idempotencia de anulación: cambió resultado';
  end if;
  if (select count(*) from public.supervisor_intervenciones where operacion_id = v_operacion_anulacion) <> 1 then
    raise exception 'FAIL idempotencia de anulación: duplicó evento';
  end if;
  v_denegado := false;
  begin
    perform public.anular_cobertura_manual_operativa(v_operacion_anulacion, v_intervencion_origen, 'Motivo diferente');
  exception when others then v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL operation_id aceptó payload distinto'; end if;

  -- Una segunda operación no puede volver a anular la misma cobertura.
  v_denegado := false;
  begin
    perform public.anular_cobertura_manual_operativa(gen_random_uuid(), v_intervencion_origen, 'Segunda anulación');
  exception when others then v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL doble anulación aceptada'; end if;

  -- Cobertura separada para forzar un fallo después de mutar y probar rollback total.
  select public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_rollback, 'sin_fichar', 'confirmar_cubierto',
    null, 'Cobertura para rollback', 'Confirmación reforzada', null, true
  ) into v_resultado_2;

  create or replace function pg_temp.fallar_anulacion_despues_mutacion()
  returns trigger language plpgsql as $f$
  begin
    if new.accion = 'anulacion_cobertura' then raise exception 'Fallo posterior intencional'; end if;
    return new;
  end;
  $f$;
  create trigger test_fallo_anulacion
  before insert on public.supervisor_intervenciones
  for each row execute function pg_temp.fallar_anulacion_despues_mutacion();

  v_denegado := false;
  begin
    perform public.anular_cobertura_manual_operativa(
      gen_random_uuid(), (v_resultado_2 ->> 'intervencion_id')::uuid, 'Debe revertirse'
    );
  exception when others then v_denegado := true;
  end;
  drop trigger test_fallo_anulacion on public.supervisor_intervenciones;
  if not v_denegado then raise exception 'FAIL no ocurrió el fallo posterior'; end if;
  if exists (
    select 1 from public.registros_asistencia
    where id = (v_resultado_2 ->> 'registro_cobertura_id')::uuid
      and (cobertura_anulada_at is not null or horas_liquidables <> 8)
  ) then raise exception 'FAIL rollback: persistió mutación de asistencia'; end if;
  if (select estado from public.turnos where id = v_turno_rollback) <> 'cubierto' then
    raise exception 'FAIL rollback: persistió mutación del turno';
  end if;

  -- Estado terminal real permitido por turnos_estado_check.
  v_turno_terminal := gen_random_uuid();
  insert into public.turnos (id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado)
  values (v_turno_terminal, null, v_objetivo, date '2099-03-01', '08:00', '16:00', 'reemplazado');
  v_denegado := false;
  begin
    perform public.registrar_intervencion_operativa(
      gen_random_uuid(), v_turno_terminal, 'descubierto', 'marcado_descubierto',
      null, 'No debe aplicar sobre turno reemplazado', null, null, false
    );
  exception when others then
    v_denegado := true;
  end;
  if not v_denegado then
    raise exception 'FAIL turno reemplazado admitió una mutación operativa';
  end if;
end;
$$;

-- Concurrencia real (dos sesiones): usar el mismo operation_id y la misma
-- intervención de origen en ambas. Resultado esperado: mismo resultado_json,
-- una sola fila de anulación y horas=0. Con operation_id igual y motivo distinto,
-- una sesión debe fallar por contexto incompatible.

rollback;
