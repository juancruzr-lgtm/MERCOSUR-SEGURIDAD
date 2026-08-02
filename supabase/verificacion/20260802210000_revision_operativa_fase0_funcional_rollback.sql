-- PRUEBA FUNCIONAL TRANSACCIONAL · REVISIÓN OPERATIVA FASE 0
-- Ejecutar solamente DESPUÉS de aplicar la migración en un ambiente de prueba.
-- Usa usuarios existentes únicamente para simular auth.uid(); todos los demás
-- datos son fixtures creados dentro de esta transacción y se eliminan con ROLLBACK.

begin;

do $$
declare
  v_admin public.usuarios%rowtype;
  v_supervisor public.usuarios%rowtype;
  v_guardia_1 public.usuarios%rowtype;
  v_guardia_2 public.usuarios%rowtype;
  v_zona_asignada uuid := gen_random_uuid();
  v_zona_ajena uuid := gen_random_uuid();
  v_objetivo_asignado uuid := gen_random_uuid();
  v_objetivo_ajeno uuid := gen_random_uuid();
  v_turno_cobertura uuid := gen_random_uuid();
  v_turno_supervisor uuid := gen_random_uuid();
  v_turno_reasignacion uuid := gen_random_uuid();
  v_turno_descubierto uuid := gen_random_uuid();
  v_turno_tardanza uuid := gen_random_uuid();
  v_turno_gps uuid := gen_random_uuid();
  v_turno_rollback uuid := gen_random_uuid();
  v_turno_terminal uuid := gen_random_uuid();
  v_registro_tardanza uuid := gen_random_uuid();
  v_registro_tardanza_2 uuid := gen_random_uuid();
  v_registro_gps uuid := gen_random_uuid();
  v_operacion_comentario uuid := gen_random_uuid();
  v_operacion_cobertura uuid := gen_random_uuid();
  v_resultado_1 jsonb;
  v_resultado_2 jsonb;
  v_intervencion_cobertura uuid;
  v_registro_cobertura uuid;
  v_horas_antes numeric;
  v_horas_despues numeric;
  v_denegado boolean;
begin
  select * into v_admin
  from public.usuarios
  where rol = 'admin' and estado = 'activo' and auth_user_id is not null
  order by created_at
  limit 1;

  select * into v_supervisor
  from public.usuarios
  where rol = 'supervisor' and estado = 'activo' and auth_user_id is not null
  order by created_at
  limit 1;

  select * into v_guardia_1
  from public.usuarios
  where rol in ('guardia', 'vigilador') and estado = 'activo'
  order by created_at
  limit 1;

  select * into v_guardia_2
  from public.usuarios
  where rol in ('guardia', 'vigilador') and estado = 'activo' and id <> v_guardia_1.id
  order by created_at
  limit 1;

  if v_admin.id is null or v_supervisor.id is null
     or v_guardia_1.id is null or v_guardia_2.id is null then
    raise exception 'Prerequisito: admin y supervisor activos con auth_user_id, más dos guardias activos';
  end if;

  insert into public.zonas_operativas (id, nombre, estado)
  values
    (v_zona_asignada, 'F0 TEST ASIGNADA ' || v_zona_asignada, 'activo'),
    (v_zona_ajena, 'F0 TEST AJENA ' || v_zona_ajena, 'activo');

  insert into public.objetivos (id, nombre, cliente, estado, zona_id)
  values
    (v_objetivo_asignado, 'F0 Objetivo asignado', 'TEST ROLLBACK', 'activo', v_zona_asignada),
    (v_objetivo_ajeno, 'F0 Objetivo ajeno', 'TEST ROLLBACK', 'activo', v_zona_ajena);

  insert into public.supervisor_zonas (supervisor_id, zona_id)
  values (v_supervisor.id, v_zona_asignada)
  on conflict do nothing;

  insert into public.turnos (id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado)
  values
    (v_turno_cobertura, v_guardia_1.id, v_objetivo_ajeno, current_date, '08:00', '16:00', 'programado'),
    (v_turno_supervisor, v_guardia_1.id, v_objetivo_asignado, current_date, '16:00', '23:00', 'programado'),
    (v_turno_reasignacion, v_guardia_1.id, v_objetivo_ajeno, date '2099-01-02', '08:00', '16:00', 'programado'),
    (v_turno_descubierto, null, v_objetivo_ajeno, date '2099-01-03', '08:00', '16:00', 'descubierto'),
    (v_turno_tardanza, v_guardia_1.id, v_objetivo_ajeno, date '2099-01-04', '08:00', '16:00', 'programado'),
    (v_turno_gps, v_guardia_1.id, v_objetivo_ajeno, date '2099-01-05', '08:00', '16:00', 'programado'),
    (v_turno_rollback, v_guardia_1.id, v_objetivo_ajeno, date '2099-01-06', '08:00', '16:00', 'programado'),
    (v_turno_terminal, null, v_objetivo_ajeno, date '2099-01-07', '08:00', '16:00', 'reemplazado');

  insert into public.registros_asistencia (
    id, turno_id, guardia_id, hora_entrada_real, alerta_entrada, gps_ingreso_estado
  ) values
    (v_registro_tardanza, v_turno_tardanza, v_guardia_1.id, '08:25', 'tarde', null),
    (v_registro_tardanza_2, v_turno_tardanza, v_guardia_2.id, '08:40', 'tarde', null),
    (v_registro_gps, v_turno_gps, v_guardia_1.id, '08:00', null, 'fuera_radio');

  -- Comentario neutro: no muta turno ni asistencia.
  perform set_config('request.jwt.claim.sub', v_admin.auth_user_id::text, true);
  select public.registrar_intervencion_operativa(
    v_operacion_comentario, v_turno_cobertura, 'sin_fichar', 'comentario',
    null, 'Prueba comentario neutro', null, null, false
  ) into v_resultado_1;

  if (select estado from public.turnos where id = v_turno_cobertura) <> 'programado' then
    raise exception 'FAIL comentario neutro: modificó el turno';
  end if;

  -- Idempotencia secuencial: mismo request, mismo JSON y una sola fila.
  select public.registrar_intervencion_operativa(
    v_operacion_comentario, v_turno_cobertura, 'sin_fichar', 'comentario',
    null, 'Prueba comentario neutro', null, null, false
  ) into v_resultado_2;

  if v_resultado_1 is distinct from v_resultado_2 then
    raise exception 'FAIL idempotencia: el reintento no devolvió el resultado original';
  end if;
  if (select count(*) from public.supervisor_intervenciones where operacion_id = v_operacion_comentario) <> 1 then
    raise exception 'FAIL idempotencia: se creó más de una intervención';
  end if;

  -- Mismo operation_id con parámetros diferentes: debe fallar.
  v_denegado := false;
  begin
    perform public.registrar_intervencion_operativa(
      v_operacion_comentario, v_turno_cobertura, 'sin_fichar', 'comentario',
      null, 'Contenido diferente', null, null, false
    );
  exception when others then
    v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL operation_id aceptó parámetros diferentes'; end if;

  -- Cobertura manual Admin: crea registro sin tiempos y 8 horas liquidables.
  select public.registrar_intervencion_operativa(
    v_operacion_cobertura, v_turno_cobertura, 'sin_fichar', 'confirmar_cubierto',
    null, 'Cobertura manual de prueba', 'Verificación administrativa', null, true
  ) into v_resultado_1;
  v_intervencion_cobertura := (v_resultado_1->>'intervencion_id')::uuid;
  v_registro_cobertura := (v_resultado_1->>'registro_cobertura_id')::uuid;

  select horas_liquidables into v_horas_antes
  from public.registros_asistencia where id = v_registro_cobertura;

  if v_horas_antes <> 8 then raise exception 'FAIL cobertura: se esperaban 8 horas, obtuvo %', v_horas_antes; end if;
  if exists (
    select 1 from public.registros_asistencia
    where id = v_registro_cobertura
      and (hora_entrada_real is not null or hora_salida_real is not null)
  ) then raise exception 'FAIL cobertura: creó tiempos reales inexistentes'; end if;

  -- Reapertura posterior: conserva cobertura y horas.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_cobertura, 'sin_fichar', 'reapertura',
    null, null, 'Cobertura registrada por error; corregir asistencia aparte', null, false
  );
  select horas_liquidables into v_horas_despues
  from public.registros_asistencia where id = v_registro_cobertura;
  if v_horas_despues is distinct from v_horas_antes then
    raise exception 'FAIL reapertura: alteró horas liquidables';
  end if;
  if not exists (
    select 1 from public.supervisor_intervenciones
    where accion = 'reapertura' and reapertura_de_id = v_intervencion_cobertura
  ) then raise exception 'FAIL reapertura: no vinculó el evento original'; end if;

  -- Supervisor puede comentar dentro de zona, pero no crear cobertura manual.
  perform set_config('request.jwt.claim.sub', v_supervisor.auth_user_id::text, true);
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_supervisor, 'sin_fichar', 'comentario',
    null, 'Comentario dentro de zona', null, null, false
  );

  v_denegado := false;
  begin
    perform public.registrar_intervencion_operativa(
      gen_random_uuid(), v_turno_supervisor, 'sin_fichar', 'confirmar_cubierto',
      null, 'Intento supervisor', 'Debe fallar', null, true
    );
  exception when others then v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL supervisor creó cobertura manual'; end if;

  -- Supervisor fuera de zona.
  v_denegado := false;
  begin
    perform public.registrar_intervencion_operativa(
      gen_random_uuid(), v_turno_reasignacion, 'sin_fichar', 'comentario',
      null, 'Intento fuera de zona', null, null, false
    );
  exception when others then v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL supervisor operó fuera de zona'; end if;

  -- Usuario inactivo.
  update public.usuarios set estado = 'inactivo' where id = v_supervisor.id;
  v_denegado := false;
  begin
    perform public.registrar_intervencion_operativa(
      gen_random_uuid(), v_turno_supervisor, 'sin_fichar', 'comentario',
      null, 'Intento inactivo', null, null, false
    );
  exception when others then v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL usuario inactivo pudo operar'; end if;
  update public.usuarios set estado = 'activo' where id = v_supervisor.id;

  perform set_config('request.jwt.claim.sub', v_admin.auth_user_id::text, true);

  -- Reasignación: cambia guardia, conserva original y no crea fichaje.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_reasignacion, 'sin_fichar', 'reasignacion',
    null, 'Reasignación de prueba', null, v_guardia_2.id, false
  );
  if not exists (
    select 1 from public.turnos
    where id = v_turno_reasignacion
      and guardia_id = v_guardia_2.id
      and guardia_original_id = v_guardia_1.id
  ) then raise exception 'FAIL reasignación: guardias incorrectos'; end if;
  if exists (select 1 from public.registros_asistencia where turno_id = v_turno_reasignacion) then
    raise exception 'FAIL reasignación: creó asistencia o fichaje';
  end if;

  -- Mantener descubierto.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_descubierto, 'descubierto', 'marcado_descubierto',
    null, 'Se mantiene sin cobertura', null, null, false
  );
  if not exists (
    select 1 from public.turnos
    where id = v_turno_descubierto and guardia_id is null and estado = 'descubierto'
  ) then raise exception 'FAIL mantener descubierto'; end if;

  -- Un estado terminal real permitido por turnos_estado_check no admite
  -- mutaciones operativas.
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

  -- Tardanza y GPS quedan vinculados a su registro exacto.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'alerta_revisada',
    v_registro_tardanza, 'Tardanza atendida', null, null, false
  );
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'alerta_revisada',
    v_registro_tardanza_2, 'Segunda tardanza atendida', null, null, false
  );
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_gps, 'fuera_radio', 'alerta_revisada',
    v_registro_gps, 'GPS atendido', null, null, false
  );
  if not exists (
    select 1 from public.supervisor_intervenciones
    where turno_id = v_turno_tardanza and tipo_alerta = 'tardanza'
      and registro_asistencia_id = v_registro_tardanza
  ) then raise exception 'FAIL identidad tardanza'; end if;

  -- Reabrir una tardanza y comentar después no reabre ni cierra la otra.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'reapertura',
    v_registro_tardanza, null, 'Reapertura de una ocurrencia', null, false
  );
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'comentario',
    v_registro_tardanza, 'Comentario posterior a reapertura', null, null, false
  );
  if (
    select si.accion from public.supervisor_intervenciones si
    where si.turno_id = v_turno_tardanza and si.tipo_alerta = 'tardanza'
      and si.registro_asistencia_id = v_registro_tardanza and si.accion <> 'comentario'
    order by si.secuencia_evento desc limit 1
  ) <> 'reapertura' then raise exception 'FAIL comentario posterior alteró reapertura'; end if;

  -- Varios comentarios posteriores siguen siendo neutrales.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'comentario',
    v_registro_tardanza, 'Segundo comentario posterior', null, null, false
  );
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'comentario',
    v_registro_tardanza, 'Tercer comentario posterior', null, null, false
  );
  if (
    select si.accion from public.supervisor_intervenciones si
    where si.turno_id = v_turno_tardanza and si.tipo_alerta = 'tardanza'
      and si.registro_asistencia_id = v_registro_tardanza and si.accion <> 'comentario'
    order by si.secuencia_evento desc limit 1
  ) <> 'reapertura' then raise exception 'FAIL varios comentarios alteraron reapertura'; end if;

  -- Comentarios de otra ocurrencia y de otro tipo no contaminan la identidad.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'comentario',
    v_registro_tardanza_2, 'Comentario de otro registro', null, null, false
  );
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_gps, 'fuera_radio', 'comentario',
    v_registro_gps, 'Comentario de otra alerta', null, null, false
  );
  if (
    select si.accion from public.supervisor_intervenciones si
    where si.turno_id = v_turno_tardanza and si.tipo_alerta = 'tardanza'
      and si.registro_asistencia_id = v_registro_tardanza and si.accion <> 'comentario'
    order by si.secuencia_evento desc limit 1
  ) <> 'reapertura' then raise exception 'FAIL comentario ajeno alteró reapertura'; end if;

  -- Reapertura + comentarios + nueva resolutiva: la resolutiva posterior sí
  -- modifica el ciclo de vida.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'alerta_revisada',
    v_registro_tardanza, 'Nueva resolución posterior', null, null, false
  );
  if (
    select si.accion from public.supervisor_intervenciones si
    where si.turno_id = v_turno_tardanza and si.tipo_alerta = 'tardanza'
      and si.registro_asistencia_id = v_registro_tardanza and si.accion <> 'comentario'
    order by si.secuencia_evento desc limit 1
  ) <> 'alerta_revisada' then raise exception 'FAIL nueva resolutiva no modificó reapertura'; end if;

  -- Resolutiva + comentario + reapertura: el comentario intermedio es neutro.
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'comentario',
    v_registro_tardanza, 'Comentario entre resolución y reapertura', null, null, false
  );
  perform public.registrar_intervencion_operativa(
    gen_random_uuid(), v_turno_tardanza, 'tardanza', 'reapertura',
    v_registro_tardanza, null, 'Nueva reapertura posterior', null, false
  );
  if (
    select si.accion from public.supervisor_intervenciones si
    where si.turno_id = v_turno_tardanza and si.tipo_alerta = 'tardanza'
      and si.registro_asistencia_id = v_registro_tardanza and si.accion <> 'comentario'
    order by si.secuencia_evento desc limit 1
  ) <> 'reapertura' then raise exception 'FAIL comentario intermedio alteró nueva reapertura'; end if;

  -- now() es constante en esta transacción: la secuencia debe resolver el
  -- empate real de timestamps sin recurrir al UUID aleatorio.
  if (
    select count(distinct si.created_at)
    from public.supervisor_intervenciones si
    where si.turno_id = v_turno_tardanza
      and si.tipo_alerta = 'tardanza'
      and si.registro_asistencia_id = v_registro_tardanza
  ) <> 1 then raise exception 'FAIL fixture no reprodujo eventos con igual timestamp'; end if;
  if (
    select si.accion from public.supervisor_intervenciones si
    where si.turno_id = v_turno_tardanza and si.tipo_alerta = 'tardanza'
      and si.registro_asistencia_id = v_registro_tardanza_2 and si.accion <> 'comentario'
    order by si.secuencia_evento desc limit 1
  ) <> 'alerta_revisada' then raise exception 'FAIL reapertura afectó otra ocurrencia'; end if;

  -- Dos operation_id distintos sobre la segunda ocurrencia ya intervenida.
  v_denegado := false;
  begin
    perform public.registrar_intervencion_operativa(
      gen_random_uuid(), v_turno_tardanza, 'tardanza', 'alerta_revisada',
      v_registro_tardanza_2, 'Intervención duplicada', null, null, false
    );
  exception when others then v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL aceptó otra operación resolutiva sobre alerta cerrada'; end if;
  if not exists (
    select 1 from public.supervisor_intervenciones
    where turno_id = v_turno_gps and tipo_alerta = 'fuera_radio'
      and registro_asistencia_id = v_registro_gps
  ) then raise exception 'FAIL identidad GPS'; end if;

  -- Forzar un error DESPUÉS de registrar_cobertura. El trigger hace fallar el
  -- INSERT de intervención; la llamada completa debe revertir asistencia y turno.
  execute $trigger$
    create function pg_temp.fase0_fallar_intervencion() returns trigger
    language plpgsql as 'begin raise exception ''Fallo posterior intencional''; end;'
  $trigger$;
  create trigger fase0_fallo_posterior
    before insert on public.supervisor_intervenciones
    for each row execute function pg_temp.fase0_fallar_intervencion();

  v_denegado := false;
  begin
    perform public.registrar_intervencion_operativa(
      gen_random_uuid(), v_turno_rollback, 'sin_fichar', 'confirmar_cubierto',
      null, 'Debe revertirse', 'Prueba rollback', null, true
    );
  exception when others then v_denegado := true;
  end;
  drop trigger fase0_fallo_posterior on public.supervisor_intervenciones;

  if not v_denegado then raise exception 'FAIL no se produjo el error posterior'; end if;
  if exists (select 1 from public.registros_asistencia where turno_id = v_turno_rollback) then
    raise exception 'FAIL atomicidad: quedó asistencia parcial';
  end if;
  if (select estado from public.turnos where id = v_turno_rollback) <> 'programado' then
    raise exception 'FAIL atomicidad: quedó el turno modificado';
  end if;
  if exists (select 1 from public.turnos_auditoria where turno_id = v_turno_rollback) then
    raise exception 'FAIL atomicidad: quedó auditoría parcial';
  end if;

  raise notice 'OK: pruebas funcionales Fase 0 completadas; el ROLLBACK final eliminará fixtures y cambios';
end;
$$;

-- Intento real de escritura directa como authenticated: debe producir
-- insufficient_privilege o una violación RLS. La excepción esperada se absorbe.
set local role authenticated;
do $$
declare
  v_denegado boolean := false;
begin
  begin
    insert into public.supervisor_intervenciones (tipo_alerta, accion)
    values ('sin_fichar', 'comentario');
  exception when insufficient_privilege then
    v_denegado := true;
  end;
  if not v_denegado then raise exception 'FAIL authenticated conserva INSERT directo'; end if;
end;
$$;
reset role;

-- Garantías estructurales para concurrencia y service_role.
select
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'supervisor_intervenciones_operacion_id_uidx'
      and indexdef ilike '%unique%'
  ) as indice_idempotencia_unico,
  has_table_privilege('service_role', 'public.supervisor_intervenciones', 'SELECT') as service_role_select,
  has_function_privilege(
    'service_role',
    'public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)',
    'EXECUTE'
  ) as service_role_execute;

-- La simultaneidad real requiere dos sesiones. Ejecutar en ambas exactamente
-- el mismo SELECT con el mismo operacion_id sobre un turno fixture compartido.
-- Resultado esperado: ambas sesiones reciben el mismo resultado_json y existe
-- una sola fila. El FOR UPDATE serializa por turno y el índice UNIQUE cubre
-- además la colisión del mismo operation_id entre turnos diferentes.

rollback;
