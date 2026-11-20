-- anular_fichaje_gps: anulación auditable de un fichaje GPS que no corresponde
--
-- CAUSA
-- Sólo existían anulaciones para cargas manuales (anular_registro_manual) y para
-- coberturas de Revisión Operativa (anular_cobertura_manual_operativa). Un
-- fichaje GPS hecho fuera del objetivo en un turno que no se trabajó no tenía
-- forma de dejar de liquidarse: corregir_registro_asistencia cambia horarios,
-- vigilador u objetivo, pero no lleva las horas a cero, y anular_turnos_lote
-- rechaza turnos pasados o con asistencia. Caso que lo origina (conciliación
-- de octubre 2026): fichaje con entrada y salida a kilómetros del objetivo en un
-- turno que el supervisor informa como cancelado.
--
-- CAMBIO
--   · Nueva RPC public.anular_fichaje_gps(p_registro_id uuid, p_motivo text).
--   · Mismo efecto que anular_registro_manual: registro_anulado_at/_por/_motivo
--     y horas_liquidables = 0. El registro, sus horas reales, coordenadas y
--     fotos se conservan como historial; nada se borra.
--   · Liquidación (lib/liquidacion: horas_liquidables guardado manda), cobertura
--     (lib/cobertura-turnos, turno_coberturas, evidencia_turno) y facturación
--     (lib/planilla-objetivo) ya tratan así a un registro anulado: no hace falta
--     tocar código de lectura.
--   · Identidad desde auth.uid() → usuarios.id activo con rol admin.
--   · Alcance validado en el servidor: alcanza_turno_actual(turno).
--   · Sólo tipo_registro = 'fichaje_gps'; las cargas manuales siguen por
--     anular_registro_manual.
--   · Sólo turnos con obligación (no reemplazado/anulado/cancelado) y ya
--     finalizados en hora argentina: no interfiere con un fichaje en curso.
--   · Confirmación reforzada: motivo obligatorio de al menos 10 caracteres.
--   · Idempotente: si el registro ya estaba anulado devuelve ya_anulado = true
--     sin escribir.
--   · Atómica: una sola transacción con FOR UPDATE sobre registro y turno; la
--     auditoría (registro_anulado y horas_liquidables) entra en la misma
--     transacción.
--   · Reabrir una alerta o anular no revierte nada más: el turno queda como está.
--
-- Reversible: supabase/rollback/20261213130000_anular_fichaje_gps_rollback.sql
-- Verificación: supabase/verificacion/20261213130000_anular_fichaje_gps.sql

create or replace function public.anular_fichaje_gps(p_registro_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_usuario_id uuid;
  v_rol text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_reg public.registros_asistencia%rowtype;
  v_turno public.turnos%rowtype;
  v_fin timestamptz;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select u.id, u.rol into v_usuario_id, v_rol
    from public.usuarios u
    where u.auth_user_id = v_uid and u.estado = 'activo';

  if v_rol is distinct from 'admin' then
    raise exception 'Sólo administración puede anular fichajes GPS';
  end if;

  if p_registro_id is null then
    raise exception 'Registro no indicado';
  end if;

  select r.* into v_reg
    from public.registros_asistencia r
    where r.id = p_registro_id
    for update;

  if not found then
    raise exception 'Registro no encontrado';
  end if;

  if coalesce(v_reg.tipo_registro, '') <> 'fichaje_gps' then
    raise exception 'Sólo se anulan fichajes GPS con esta acción; una carga manual se anula con anular_registro_manual';
  end if;

  select t.* into v_turno
    from public.turnos t
    where t.id = v_reg.turno_id
    for update;

  if not found then
    raise exception 'Turno del fichaje no encontrado';
  end if;

  if not public.alcanza_turno_actual(v_turno.id) then
    raise exception 'No autorizado para este objetivo';
  end if;

  if v_reg.registro_anulado_at is not null then
    return jsonb_build_object('registro_id', v_reg.id, 'turno_id', v_turno.id, 'ya_anulado', true);
  end if;

  if v_motivo is null or length(v_motivo) < 10 then
    raise exception 'El motivo de anulación es obligatorio (al menos 10 caracteres)';
  end if;

  if coalesce(v_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    raise exception 'El turno está %; no admite mutaciones operativas', v_turno.estado;
  end if;

  v_fin := ((v_turno.fecha
             + case when v_turno.hora_fin <= v_turno.hora_inicio then 1 else 0 end)::text
            || ' ' || v_turno.hora_fin)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  if v_fin > now() then
    raise exception 'El turno todavía no finalizó';
  end if;

  update public.registros_asistencia
     set registro_anulado_at = now(),
         registro_anulado_por = v_uid,
         registro_anulado_motivo = v_motivo,
         horas_liquidables = 0
   where id = v_reg.id;

  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values
    (v_reg.id, v_turno.id, v_usuario_id, 'registro_anulado', null, 'anulado', v_motivo),
    (v_reg.id, v_turno.id, v_usuario_id, 'horas_liquidables',
     v_reg.horas_liquidables::text, '0',
     format('Anulación de fichaje GPS (entrada %s, salida %s, horas trabajadas %s)',
            coalesce(to_char(coalesce(v_reg.hora_entrada_final, v_reg.hora_entrada_real), 'HH24:MI'), '—'),
            coalesce(to_char(coalesce(v_reg.hora_salida_final, v_reg.hora_salida_real), 'HH24:MI'), '—'),
            coalesce(v_reg.horas_trabajadas::text, '—')));

  return jsonb_build_object('registro_id', v_reg.id, 'turno_id', v_turno.id, 'ya_anulado', false);
end;
$function$;

revoke all on function public.anular_fichaje_gps(uuid, text) from public, anon;
grant execute on function public.anular_fichaje_gps(uuid, text) to authenticated;
