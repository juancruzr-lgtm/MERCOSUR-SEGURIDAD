-- reactivar_turno_anulado_trabajado: también la usa el supervisor
--
-- CAUSA
-- 20261213140000 la dejó sólo para administración. Quien cierra los turnos del mes es el supervisor, y
-- es quien detecta un turno anulado por error que se trabajó: tiene que poder reactivarlo él.
--
-- CAMBIO
-- Acepta rol admin o supervisor (usuario activo). El resto sigue igual: alcance por zona
-- (alcanza_zona_actual: el supervisor sólo en sus zonas), turno ya terminado, evidencia de que se
-- trabajó (fichaje de entrada y salida o carga manual con horas), motivo obligatorio, control de
-- superposición y auditoría en turnos_auditoria.
--
-- Reversible: supabase/rollback/20261213150000_reactivar_turno_supervisor_rollback.sql

create or replace function public.reactivar_turno_anulado_trabajado(p_turno_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_actor public.usuarios%rowtype;
  v_t public.turnos%rowtype;
  v_zona uuid;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_ahora timestamp := (now() at time zone 'America/Argentina/Buenos_Aires');
  v_fin timestamp;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into v_actor from public.usuarios u where u.auth_user_id = v_uid and u.estado = 'activo';
  -- Administración o supervisión (el supervisor es quien cierra los turnos); el alcance por zona lo
  -- controla alcanza_zona_actual más abajo (un supervisor sólo en sus zonas asignadas).
  if v_actor.id is null or v_actor.rol not in ('admin', 'supervisor') then
    raise exception 'Sólo administración o supervisión activa puede reactivar turnos anulados';
  end if;
  if v_motivo is null or length(v_motivo) < 10 then raise exception 'El motivo es obligatorio (mínimo 10 caracteres)'; end if;

  select * into v_t from public.turnos where id = p_turno_id for update;
  if v_t.id is null then raise exception 'Turno inexistente'; end if;
  select o.zona_id into v_zona from public.objetivos o where o.id = v_t.objetivo_id;
  if not public.alcanza_zona_actual(v_zona) then raise exception 'Objetivo fuera de tu alcance'; end if;

  if coalesce(v_t.estado, '') not in ('anulado', 'cancelado') then
    if v_t.estado = 'reemplazado' then raise exception 'El turno fue reemplazado por otro: no se reactiva'; end if;
    return jsonb_build_object('estado', 'sin_cambios', 'turno_id', v_t.id, 'estado_turno', v_t.estado);
  end if;

  v_fin := v_t.fecha + v_t.hora_fin + case when v_t.hora_fin <= v_t.hora_inicio then interval '1 day' else interval '0 day' end;
  if v_fin > v_ahora then raise exception 'El turno todavía no terminó: se reactiva desde la grilla'; end if;

  if not exists (
    select 1 from public.registros_asistencia r
     where r.turno_id = v_t.id and r.registro_anulado_at is null and r.cobertura_anulada_at is null
       and coalesce(r.tipo_registro, '') <> 'ausencia'
       and ((r.hora_entrada_real is not null and r.hora_salida_real is not null)
            or (r.tipo_registro = 'carga_manual' and coalesce(r.horas_liquidables, 0) > 0))
  ) then
    raise exception 'El turno no tiene fichaje de entrada y salida ni carga manual con horas: no hay evidencia de que se trabajó';
  end if;

  update public.turnos set estado = 'programado' where id = v_t.id;

  insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values (v_t.id, v_actor.id, 'estado', v_t.estado, 'programado', 'Reactivado: anulado por error y trabajado. ' || v_motivo);

  return jsonb_build_object('estado', 'reactivado', 'turno_id', v_t.id, 'estado_anterior', v_t.estado);
end $function$;

revoke all on function public.reactivar_turno_anulado_trabajado(uuid, text) from public, anon;
grant execute on function public.reactivar_turno_anulado_trabajado(uuid, text) to authenticated;
