-- Rollback de 20261213100000_anular_registro_manual_auditoria_usuario.sql
-- Vuelve a la definición anterior (la que fallaba con 23503 al auditar con auth.uid()).
-- Las anulaciones ya hechas con la versión corregida quedan como están.
begin;
create or replace function public.anular_registro_manual(p_registro_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
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
$function$;
revoke all on function public.anular_registro_manual(uuid, text) from public, anon;
grant execute on function public.anular_registro_manual(uuid, text) to authenticated;
commit;
