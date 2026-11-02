-- ROLLBACK de 20261113120000_programacion_conflictos_correccion_turnos.sql
-- Restaura asignar_vigilador_turnos y rondas_ventanas_programadas a la versión
-- previa, quita las RPC nuevas y el trigger de alta. Las tablas de constancia
-- NO se borran (conservan historial de auditoría); quedan sin escritura.
begin;

drop trigger if exists trg_turnos_auditar_alta on public.turnos;
drop function if exists public.turnos_auditar_alta();
drop function if exists public.corregir_turno_programacion(uuid, uuid, text, text, time, time, timestamptz, boolean);
drop function if exists public.evidencia_turno(uuid);
drop function if exists public.conflictos_turno_vigilador(uuid, uuid, time, time);
drop function if exists public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean, boolean, text);

-- asignar_vigilador_turnos (versión de 20260908130000)
CREATE OR REPLACE FUNCTION public.asignar_vigilador_turnos(p_operacion_id uuid, p_guardia_id uuid, p_turno_ids uuid[], p_masiva boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid; v_actor record; v_zonas uuid[];
  v_alcance   text; v_guardia record; v_tid uuid; v_turno record;
  v_hoy_arg date; v_hora_arg time; v_ini1 timestamp; v_fin1 timestamp;
  v_res text; v_motivo text; v_filas jsonb := '[]'::jsonb;
  v_asignadas integer := 0; v_ya integer := 0; v_omitidas integer := 0; v_comentario text;
  v_conf record; v_conflicto jsonb; v_nombre text;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id, rol into v_actor from public.usuarios
  where auth_user_id = v_uid and estado = 'activo' and rol in ('admin','supervisor');
  if not found then raise exception 'No autorizado: la asignacion es de administracion o supervision'; end if;
  v_alcance := public.alcance_operativo_de(v_actor.id);
  if v_alcance = 'zonas_asignadas' then
    select array_agg(zona_id) into v_zonas from public.supervisor_zonas where supervisor_id = v_actor.id;
  end if;
  if p_operacion_id is null then raise exception 'operacion_id requerido'; end if;
  if p_guardia_id is null then raise exception 'Vigilador requerido'; end if;
  if p_turno_ids is null or array_length(p_turno_ids,1) is null then raise exception 'No hay turnos seleccionados'; end if;
  if array_length(p_turno_ids,1) > 100 then raise exception 'Demasiados turnos para una sola operacion (maximo 100)'; end if;
  select estado, rol, apellido, nombre into v_guardia from public.usuarios where id = p_guardia_id;
  if not found or v_guardia.estado <> 'activo' or v_guardia.rol not in ('guardia','vigilador') then
    raise exception 'El vigilador elegido no esta activo'; end if;
  v_nombre := trim(both ', ' from concat_ws(', ',
    nullif(trim(coalesce(v_guardia.apellido,'')),''), nullif(trim(coalesce(v_guardia.nombre,'')),'')));
  if v_nombre = '' then v_nombre := 'el vigilador'; end if;
  v_hoy_arg  := ((now() at time zone 'UTC') - interval '3 hours')::date;
  v_hora_arg := ((now() at time zone 'UTC') - interval '3 hours')::time;
  v_comentario := 'Asignacion ' || case when p_masiva then 'masiva' else 'individual' end
    || ' de vigilador (operacion ' || p_operacion_id::text || ')';
  foreach v_tid in array p_turno_ids loop
    v_res := 'omitida'; v_motivo := null; v_conflicto := null;
    begin
      select t.*, o.estado as objetivo_estado, o.zona_id as objetivo_zona, p.activo as puesto_activo
      into v_turno from public.turnos t
      join public.objetivos o on o.id = t.objetivo_id
      left join public.puestos p on p.id = t.puesto_id
      where t.id = v_tid for update of t;
      if not found then raise exception 'Turno inexistente'; end if;
      if v_turno.objetivo_estado <> 'activo' then raise exception 'Objetivo inactivo'; end if;
      if v_alcance = 'zonas_asignadas' AND NOT (v_turno.objetivo_zona = ANY (COALESCE(v_zonas, '{}'::uuid[]))) then
        raise exception 'Objetivo fuera de la zona del supervisor'; end if;
      if v_turno.puesto_id is not null and v_turno.puesto_activo is distinct from true then
        raise exception 'Posicion operativa inactiva'; end if;
      if coalesce(v_turno.estado,'') in ('reemplazado','anulado','cancelado') then
        raise exception 'Turno sin obligacion de cobertura'; end if;
      if coalesce(v_turno.tipo_evento,'normal') <> 'normal' then
        raise exception 'Solo se asignan turnos de cobertura normal'; end if;
      if v_turno.fecha < v_hoy_arg or (v_turno.fecha = v_hoy_arg and v_turno.hora_inicio <= v_hora_arg) then
        raise exception 'El turno ya inicio o es pasado'; end if;
      perform 1 from public.registros_asistencia r
      where r.turno_id = v_turno.id and coalesce(r.tipo_registro,'') <> 'ausencia'
        and (r.hora_entrada_real is not null or r.hora_entrada_final is not null);
      if found then raise exception 'El turno ya tiene asistencia registrada'; end if;
      if v_turno.guardia_id is not null then
        if v_turno.guardia_id = p_guardia_id then
          v_res := 'ya_asignada'; v_motivo := 'Ya estaba asignado a este vigilador';
        else raise exception 'Ya asignado a otro vigilador: reasignar desde la edicion del turno'; end if;
      else
        v_ini1 := v_turno.fecha + v_turno.hora_inicio;
        v_fin1 := v_turno.fecha + v_turno.hora_fin
          + case when v_turno.hora_fin <= v_turno.hora_inicio then interval '1 day' else interval '0 day' end;
        select t2.id, t2.fecha, t2.hora_inicio, t2.hora_fin, o2.nombre as objetivo_nombre, p2.nombre as puesto_nombre
        into v_conf from public.turnos t2
        join public.objetivos o2 on o2.id = t2.objetivo_id
        left join public.puestos p2 on p2.id = t2.puesto_id
        where t2.guardia_id = p_guardia_id and t2.id <> v_turno.id
          and coalesce(t2.estado,'') not in ('reemplazado','anulado','cancelado')
          and o2.estado = 'activo'
          and t2.fecha between v_turno.fecha - 1 and v_turno.fecha + 1
          and (t2.fecha + t2.hora_inicio) < v_fin1
          and v_ini1 < (t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end)
        order by t2.fecha, t2.hora_inicio limit 1;
        if found then
          v_conflicto := jsonb_build_object('turno_id', v_conf.id, 'vigilador', v_nombre,
            'objetivo', v_conf.objetivo_nombre, 'puesto', v_conf.puesto_nombre, 'fecha', v_conf.fecha,
            'hora_inicio', to_char(v_conf.hora_inicio,'HH24:MI'), 'hora_fin', to_char(v_conf.hora_fin,'HH24:MI'));
          raise exception 'No se puede asignar a %. Ya tiene un turno de % a % en % el %.',
            v_nombre, to_char(v_conf.hora_inicio,'HH24:MI'), to_char(v_conf.hora_fin,'HH24:MI'),
            coalesce(v_conf.objetivo_nombre,'otro objetivo')
              || case when v_conf.puesto_nombre is null then '' else ' (' || v_conf.puesto_nombre || ')' end,
            to_char(v_conf.fecha,'DD/MM/YYYY');
        end if;
        update public.turnos set guardia_id = p_guardia_id,
          guardia_original_id = coalesce(guardia_original_id, p_guardia_id) where id = v_turno.id;
        insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
        values (v_turno.id, v_actor.id, 'guardia_id', null, p_guardia_id::text, v_comentario);
        if v_turno.guardia_original_id is null then
          insert into public.turnos_auditoria (turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
          values (v_turno.id, v_actor.id, 'guardia_original_id', null, p_guardia_id::text, v_comentario);
        end if;
        v_res := 'asignada';
      end if;
    exception when others then v_res := 'omitida'; v_motivo := sqlerrm;
    end;
    if v_res = 'asignada' then v_asignadas := v_asignadas + 1;
    elsif v_res = 'ya_asignada' then v_ya := v_ya + 1;
    else v_omitidas := v_omitidas + 1; end if;
    v_filas := v_filas || jsonb_build_object('turno_id', v_tid, 'resultado', v_res, 'motivo', v_motivo, 'conflicto', v_conflicto);
  end loop;
  return jsonb_build_object('operacion_id', p_operacion_id, 'guardia_id', p_guardia_id,
    'solicitadas', array_length(p_turno_ids,1), 'asignadas', v_asignadas,
    'ya_asignadas', v_ya, 'omitidas', v_omitidas, 'filas', v_filas);
end;
$function$;

revoke all on function public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean) from public, anon;
grant execute on function public.asignar_vigilador_turnos(uuid, uuid, uuid[], boolean) to authenticated;

drop function if exists public.conflictos_turno_vigilador_core(uuid, date, time, time, uuid, uuid);

-- rondas_ventanas_programadas (versión de 20261104120000)
create or replace function public.rondas_ventanas_programadas(
  p_objetivo_id uuid,            -- NULL = todos los objetivos (excluye es_prueba)
  p_desde       date,
  p_hasta       date
)
returns table (
  turno_id       uuid,
  objetivo_id    uuid,
  puesto_id      uuid,
  guardia_id     uuid,
  ronda_base_id  uuid,
  indice         integer,
  ventana_inicio timestamptz,
  ventana_fin    timestamptz,
  match_fin      timestamptz,
  vencimiento_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_tol_min int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_tolerancia_min'), 15);
  v_tol     interval;

  r_turno   record;
  r_ronda   record;
  v_t_ini   timestamp;   -- inicio del turno (local)
  v_t_fin   timestamp;   -- fin del turno (local, +1 dia si nocturno)
  v_interv  interval;
  v_base    timestamp;
  v_vi      timestamp;
  v_vf      timestamp;
  v_mf      timestamp;
  v_n       int;
begin
  v_tol := make_interval(mins => v_tol_min);

  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    return;
  end if;

  for r_turno in
    select t.id, t.fecha, t.hora_inicio, t.hora_fin,
           t.objetivo_id, t.puesto_id, t.guardia_id
    from public.turnos t
    join public.objetivos o on o.id = t.objetivo_id
    where t.puesto_id  is not null
      and t.guardia_id is not null
      and t.fecha between p_desde and p_hasta
      and (p_objetivo_id is null or t.objetivo_id = p_objetivo_id)
      -- Alcance completo: nunca objetivos de prueba. Objetivo explicito: tal cual.
      and (p_objetivo_id is not null or o.es_prueba = false)
      -- ── La jornada con ausencia no exige rondas ───────────────────────────
      -- La falta primaria es la ausencia, y ya se cuenta en Asistencia. Cobrar
      -- ademas las rondas de un turno que la persona no trabajo es castigar dos
      -- veces el mismo hecho.
      and not exists (
        select 1
          from public.registros_asistencia ra
         where ra.turno_id = t.id
           and ra.tipo_registro = 'ausencia'
      )
  loop
    v_t_ini := r_turno.fecha + r_turno.hora_inicio;
    v_t_fin := r_turno.fecha + r_turno.hora_fin
             + case when r_turno.hora_fin <= r_turno.hora_inicio
                    then interval '1 day' else interval '0' end;

    for r_ronda in
      select rb.id, rb.hora_inicio, rb.intervalo_minutos, rb.created_at
      from public.rondas_base rb
      where rb.puesto_id = r_turno.puesto_id
        and rb.activo
        -- Una ronda sin puntos no se puede cumplir. Aunque quedara activa por
        -- error, aca no genera obligacion: es la ultima barrera y esta en la
        -- autoridad, no en una pantalla que alguien puede saltear.
        and exists (
          select 1 from public.ronda_puntos rp
           where rp.ronda_base_id = rb.id and rp.activo
        )
    loop
      v_interv := r_ronda.intervalo_minutos * interval '1 minute';

      if r_ronda.hora_inicio is null then
        v_base := v_t_ini;
      else
        v_base := r_turno.fecha + r_ronda.hora_inicio;
        -- Reposiciona la hora de inicio dentro de la ventana del turno (nocturno).
        while v_base < v_t_ini loop
          v_base := v_base + interval '1 day';
        end loop;
      end if;

      v_n := 0;
      loop
        v_vi := v_base + (v_n * v_interv);
        exit when v_vi >= v_t_fin;              -- fin de las obligaciones del turno

        -- ── Nada anterior a la creacion de la ronda ────────────────────────
        -- No es un filtro de presentacion: es que esa obligacion NO EXISTIO.
        -- Nadie pudo haberla cumplido, asi que no puede contar como incumplida
        -- ni generar una alerta.
        if (v_vi at time zone v_tz) < r_ronda.created_at then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        -- ── Horario en que la ronda no se exige ────────────────────────────
        -- Operaciones puede declarar que una ronda no se exige un día y en un
        -- horario (p. ej. Laromet: domingo desde las 06, el vigilador hace de
        -- portero). La ventana cuyo INICIO cae en ese horario no existe como
        -- obligación: no genera alerta ni cuenta en la evaluación. Mismo
        -- criterio que las pausas (inicio de la ventana).
        if exists (
          select 1 from public.ronda_horarios_sin_exigencia h
           where h.ronda_base_id = r_ronda.id
             and h.activo
             and h.dia_semana = extract(isodow from v_vi)::int
             and v_vi::time >= h.desde
             and v_vi::time <  h.hasta
        ) then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        v_vf := least(v_vi + v_interv, v_t_fin); -- deadline (acotado al turno)
        v_mf := v_vi + v_interv;                 -- limite de matching (sin acotar)

        turno_id       := r_turno.id;
        objetivo_id    := r_turno.objetivo_id;
        puesto_id      := r_turno.puesto_id;
        guardia_id     := r_turno.guardia_id;
        ronda_base_id  := r_ronda.id;
        indice         := v_n;
        ventana_inicio := v_vi           at time zone v_tz;
        ventana_fin    := v_vf           at time zone v_tz;
        match_fin      := v_mf           at time zone v_tz;
        vencimiento_at := (v_vf + v_tol) at time zone v_tz;
        return next;

        v_n := v_n + 1;
        exit when v_n > 10000;                  -- backstop defensivo
      end loop;
    end loop;
  end loop;

  return;
end;
$fn$;

revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from anon;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from authenticated;

notify pgrst, 'reload schema';
commit;
