-- Anulación lógica de registros creados manualmente (tipo_registro = 'carga_manual').
--
-- Semántica:
--   - No borra el registro físicamente.
--   - Marca el registro como anulado con fecha, usuario y motivo.
--   - Pone horas_liquidables en 0.
--   - Registra auditoría completa.
--   - Si la planilla mensual está cerrada, rechaza la operación.
--
-- Solo admin puede anular.

-- 1. Agregar columnas de anulación si no existen
alter table public.registros_asistencia
  add column if not exists registro_anulado_at timestamptz,
  add column if not exists registro_anulado_por uuid,
  add column if not exists registro_anulado_motivo text;

-- 2. RPC para anular registro manual
create or replace function public.anular_registro_manual(
  p_registro_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid;
  v_rol text;
  v_tipo_registro text;
  v_turno_id uuid;
  v_horas_antes numeric;
  v_ya_anulado boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select rol into v_rol
    from public.usuarios
    where auth_user_id = v_uid;

  if v_rol is distinct from 'admin' then
    raise exception 'Solo administración puede anular registros manuales';
  end if;

  select tipo_registro, turno_id, coalesce(horas_liquidables, 0),
         registro_anulado_at is not null
    into v_tipo_registro, v_turno_id, v_horas_antes, v_ya_anulado
    from public.registros_asistencia
    where id = p_registro_id;

  if v_tipo_registro is null then
    raise exception 'Registro no encontrado';
  end if;

  if v_tipo_registro <> 'carga_manual' then
    raise exception 'Solo se pueden anular registros creados manualmente';
  end if;

  if v_ya_anulado then
    raise notice 'Registro ya anulado; operación idempotente';
    return;
  end if;

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de anulación es obligatorio';
  end if;

  update public.registros_asistencia
    set registro_anulado_at = now(),
        registro_anulado_por = v_uid,
        registro_anulado_motivo = p_motivo,
        horas_liquidables = 0
    where id = p_registro_id;

  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values
    (p_registro_id, v_turno_id, v_uid, 'registro_anulado',
     null, 'anulado', p_motivo),
    (p_registro_id, v_turno_id, v_uid, 'horas_liquidables',
     v_horas_antes::text, '0', 'Anulación de registro manual');
end;
$$;

-- 3. RPC para corregir fecha de registro manual
create or replace function public.corregir_fecha_registro_manual(
  p_registro_id uuid,
  p_nueva_fecha date,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid;
  v_rol text;
  v_tipo_registro text;
  v_turno_id uuid;
  v_turno_fecha date;
  v_conflicto boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select rol into v_rol
    from public.usuarios
    where auth_user_id = v_uid;

  if v_rol is distinct from 'admin' then
    raise exception 'Solo administración puede corregir la fecha de registros manuales';
  end if;

  select tipo_registro, turno_id
    into v_tipo_registro, v_turno_id
    from public.registros_asistencia
    where id = p_registro_id;

  if v_tipo_registro is null then
    raise exception 'Registro no encontrado';
  end if;

  if v_tipo_registro <> 'carga_manual' then
    raise exception 'Solo se puede corregir la fecha de registros creados manualmente';
  end if;

  if nullif(btrim(p_motivo), '') is null then
    raise exception 'El motivo de corrección es obligatorio';
  end if;

  select fecha into v_turno_fecha
    from public.turnos
    where id = v_turno_id;

  if v_turno_fecha is null then
    raise exception 'Turno asociado no encontrado';
  end if;

  -- Verificar que no exista conflicto en la fecha destino
  select exists(
    select 1 from public.turnos t2
    join public.registros_asistencia r2 on r2.turno_id = t2.id
    where t2.fecha = p_nueva_fecha
      and t2.objetivo_id = (select objetivo_id from public.turnos where id = v_turno_id)
      and r2.guardia_id = (select guardia_id from public.registros_asistencia where id = p_registro_id)
      and r2.id <> p_registro_id
      and r2.registro_anulado_at is null
  ) into v_conflicto;

  if v_conflicto then
    raise exception 'Ya existe un registro para ese guardia y objetivo en la fecha destino';
  end if;

  -- Actualizar la fecha del turno asociado
  update public.turnos
    set fecha = p_nueva_fecha
    where id = v_turno_id;

  -- Auditoría
  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values
    (p_registro_id, v_turno_id, v_uid, 'fecha_turno',
     v_turno_fecha::text, p_nueva_fecha::text, p_motivo);

  insert into public.turnos_auditoria
    (turno_id, campo, valor_anterior, valor_nuevo, modificado_por, motivo)
  values
    (v_turno_id, 'fecha', v_turno_fecha::text, p_nueva_fecha::text, v_uid, p_motivo);
end;
$$;
