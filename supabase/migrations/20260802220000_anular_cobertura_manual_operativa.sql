-- Anulación auditable de coberturas manuales creadas por Revisión Operativa.
-- Debe aplicarse después de 20260802210000_revision_operativa_fase0.sql.

do $$
begin
  if to_regprocedure('public.registrar_intervencion_operativa(uuid,uuid,text,text,uuid,text,text,uuid,boolean)') is null then
    raise exception 'Dependencia faltante: registrar_intervencion_operativa de Fase 0';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'supervisor_intervenciones'
      and column_name in ('operacion_id', 'solicitud_json', 'resultado_json')
    group by table_schema, table_name
    having count(*) = 3
  ) then
    raise exception 'Dependencia faltante: columnas idempotentes de Fase 0';
  end if;
end;
$$;

alter table public.registros_asistencia
  add column if not exists cobertura_anulada_at timestamptz,
  add column if not exists cobertura_anulada_por uuid references public.usuarios(id),
  add column if not exists cobertura_anulada_motivo text,
  add column if not exists cobertura_intervencion_origen_id uuid references public.supervisor_intervenciones(id),
  add column if not exists cobertura_anulacion_intervencion_id uuid,
  add column if not exists horas_liquidables_antes_anulacion numeric;

alter table public.registros_asistencia
  drop constraint if exists registros_asistencia_cobertura_anulada_horas_cero;

alter table public.registros_asistencia
  add constraint registros_asistencia_cobertura_anulada_horas_cero
  check (cobertura_anulada_at is null or coalesce(horas_liquidables, 0) = 0);

alter table public.registros_asistencia
  drop constraint if exists registros_asistencia_cobertura_anulacion_intervencion_fk;

alter table public.registros_asistencia
  add constraint registros_asistencia_cobertura_anulacion_intervencion_fk
  foreign key (cobertura_anulacion_intervencion_id)
  references public.supervisor_intervenciones(id)
  deferrable initially deferred;

alter table public.supervisor_intervenciones
  add column if not exists cobertura_origen_intervencion_id uuid references public.supervisor_intervenciones(id);

create index if not exists registros_asistencia_cobertura_origen_idx
  on public.registros_asistencia (cobertura_intervencion_origen_id)
  where cobertura_intervencion_origen_id is not null;

create or replace function public.anular_cobertura_manual_operativa(
  p_operacion_id uuid,
  p_intervencion_origen_id uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_usuario public.usuarios%rowtype;
  v_origen public.supervisor_intervenciones%rowtype;
  v_existente public.supervisor_intervenciones%rowtype;
  v_turno public.turnos%rowtype;
  v_registro public.registros_asistencia%rowtype;
  v_registro_id uuid;
  v_intervencion_id uuid := gen_random_uuid();
  v_ahora timestamptz := clock_timestamp();
  v_estado_nuevo text;
  v_zona text;
  v_solicitud_json jsonb;
  v_resultado_json jsonb;
begin
  if p_operacion_id is null or p_intervencion_origen_id is null then
    raise exception 'operacion_id e intervencion_origen_id son obligatorios';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de anulación es obligatorio';
  end if;
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select u.* into v_usuario
  from public.usuarios u
  where u.auth_user_id = v_uid
    and u.estado = 'activo'
    and u.rol = 'admin'
  limit 1;
  if not found then
    raise exception 'La anulación de cobertura manual está reservada a administración activa';
  end if;

  v_solicitud_json := jsonb_build_object(
    'accion', 'anulacion_cobertura',
    'intervencion_origen_id', p_intervencion_origen_id,
    'motivo', btrim(p_motivo)
  );

  select si.* into v_existente
  from public.supervisor_intervenciones si
  where si.operacion_id = p_operacion_id;
  if found then
    if v_existente.supervisor_id is distinct from v_usuario.id
       or v_existente.solicitud_json is distinct from v_solicitud_json then
      raise exception 'operacion_id ya utilizado con otro contexto';
    end if;
    return v_existente.resultado_json;
  end if;

  select si.* into v_origen
  from public.supervisor_intervenciones si
  where si.id = p_intervencion_origen_id
  for update;
  if not found or v_origen.accion not in ('confirmar_cubierto', 'marcado_cubierto_manual') then
    raise exception 'La intervención indicada no originó una cobertura manual';
  end if;

  select t.* into v_turno
  from public.turnos t
  where t.id = v_origen.turno_id
  for update;
  if not found then
    raise exception 'Turno de la cobertura no encontrado';
  end if;
  if not public.puede_administrar_rondas_objetivo(v_turno.objetivo_id) then
    raise exception 'No autorizado para administrar este objetivo';
  end if;

  begin
    v_registro_id := nullif(v_origen.resultado_json ->> 'registro_cobertura_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'La intervención de origen no contiene una identidad de cobertura válida';
  end;
  if v_registro_id is null then
    raise exception 'La intervención de origen no identifica el registro de cobertura';
  end if;

  select r.* into v_registro
  from public.registros_asistencia r
  where r.id = v_registro_id
  for update;
  if not found
     or v_registro.turno_id is distinct from v_turno.id
     or v_registro.tipo_registro is distinct from 'carga_manual'
     or v_registro.origen_cobertura is distinct from 'confirmacion_admin' then
    raise exception 'El registro no es una cobertura manual de Revisión Operativa';
  end if;
  if v_registro.cobertura_anulada_at is not null then
    raise exception 'La cobertura manual ya fue anulada';
  end if;

  update public.registros_asistencia
  set horas_liquidables_antes_anulacion = horas_liquidables,
      horas_liquidables = 0,
      cobertura_anulada_at = v_ahora,
      cobertura_anulada_por = v_usuario.id,
      cobertura_anulada_motivo = btrim(p_motivo),
      cobertura_intervencion_origen_id = v_origen.id,
      cobertura_anulacion_intervencion_id = v_intervencion_id
  where id = v_registro.id;

  insert into public.registros_asistencia_auditoria (
    registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
  ) values
    (v_registro.id, v_turno.id, v_usuario.id, 'horas_liquidables', v_registro.horas_liquidables::text, '0', btrim(p_motivo)),
    (v_registro.id, v_turno.id, v_usuario.id, 'cobertura_anulada_at', null, v_ahora::text, btrim(p_motivo));

  v_estado_nuevo := v_turno.estado;
  if v_turno.estado = 'cubierto' and not exists (
    select 1
    from public.registros_asistencia r
    where r.turno_id = v_turno.id
      and r.id <> v_registro.id
      and r.tipo_registro is distinct from 'ausencia'
      and r.cobertura_anulada_at is null
      and (
        coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null
        or coalesce(r.horas_liquidables, 0) > 0
      )
  ) then
    v_estado_nuevo := 'programado';
    update public.turnos set estado = v_estado_nuevo where id = v_turno.id;
    insert into public.turnos_auditoria (
      turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario
    ) values (
      v_turno.id, v_usuario.id, 'estado', v_turno.estado, v_estado_nuevo,
      'Estado recalculado al anular cobertura manual: ' || btrim(p_motivo)
    );
  end if;

  select z.nombre into v_zona
  from public.objetivos o
  left join public.zonas_operativas z on z.id = o.zona_id
  where o.id = v_turno.objetivo_id;

  v_resultado_json := jsonb_build_object(
    'estado', 'aplicada',
    'intervencion_id', v_intervencion_id,
    'intervencion_origen_id', v_origen.id,
    'turno_id', v_turno.id,
    'registro_cobertura_id', v_registro.id,
    'horas_liquidables_antes', v_registro.horas_liquidables,
    'horas_liquidables_despues', 0,
    'estado_turno', v_estado_nuevo
  );

  insert into public.supervisor_intervenciones (
    id, operacion_id, turno_id, registro_asistencia_id,
    supervisor_id, supervisor_intervino_id, tipo_alerta, accion,
    comentario, motivo, guardia_anterior_id, guardia_nuevo_id,
    estado_anterior, estado_nuevo, zona, cobertura_origen_intervencion_id,
    solicitud_json, resultado_json, created_at
  ) values (
    v_intervencion_id, p_operacion_id, v_turno.id, null,
    v_usuario.id, v_usuario.id, 'sin_fichar', 'anulacion_cobertura',
    null, btrim(p_motivo), v_turno.guardia_id, v_turno.guardia_id,
    v_turno.estado, v_estado_nuevo, v_zona, v_origen.id,
    v_solicitud_json, v_resultado_json, v_ahora
  );

  return v_resultado_json;
exception
  when unique_violation then
    select si.* into v_existente
    from public.supervisor_intervenciones si
    where si.operacion_id = p_operacion_id;
    if found and v_existente.supervisor_id = v_usuario.id
       and v_existente.solicitud_json = v_solicitud_json then
      return v_existente.resultado_json;
    end if;
    raise;
end;
$$;

revoke all on function public.anular_cobertura_manual_operativa(uuid, uuid, text) from public;
revoke all on function public.anular_cobertura_manual_operativa(uuid, uuid, text) from anon;
grant execute on function public.anular_cobertura_manual_operativa(uuid, uuid, text) to authenticated;
grant execute on function public.anular_cobertura_manual_operativa(uuid, uuid, text) to service_role;

comment on function public.anular_cobertura_manual_operativa(uuid, uuid, text) is
  'Anula de forma atómica e idempotente una cobertura manual de Revisión Operativa sin borrar historial.';
