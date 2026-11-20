-- Funciones (cuerpo real con pg_get_functiondef) y su ACL. Generado con scripts/db-snapshot/consultas.sql (2).

CREATE OR REPLACE FUNCTION public._registro_liquidable_validar(p_op text, p_new jsonb, p_old jsonb, p_directo boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_protegidas constant text[] := array[
    'horas_liquidables', 'origen_cobertura', 'guardia_final_id', 'objetivo_final_id',
    'hora_entrada_final', 'hora_salida_final', 'cobertura_anulada_at', 'cobertura_anulada_por',
    'cobertura_anulada_motivo', 'cobertura_intervencion_origen_id', 'cobertura_anulacion_intervencion_id',
    'horas_liquidables_antes_anulacion', 'registro_anulado_at', 'registro_anulado_por',
    'registro_anulado_motivo', 'excepcion_asistencia_id', 'cierre_automatico'];
  v_col text;
  v_new_h numeric := coalesce((p_new ->> 'horas_liquidables')::numeric, 0);
  v_old_h numeric := coalesce((p_old ->> 'horas_liquidables')::numeric, 0);
  v_exc_old uuid := (p_old ->> 'excepcion_asistencia_id')::uuid;
  v_manual boolean;
  v_t public.turnos%rowtype;
  v_guardia uuid;
  v_prog numeric;
  v_cubierto numeric;
  v_ev text;
  v_exc uuid;
begin
  if pg_trigger_depth() < 1 then
    raise exception 'Sólo se invoca desde el trigger de registros_asistencia';
  end if;

  -- a) Escrituras directas por PostgREST: no tocan columnas que definen horas
  --    liquidables. Esas pasan por RPC (registrar_cobertura, intervenciones,
  --    correcciones, anulaciones) o por el servicio.
  if p_directo then
    foreach v_col in array v_protegidas loop
      if p_op = 'INSERT' then
        if v_col = 'cierre_automatico' then
          if coalesce((p_new ->> v_col)::boolean, false) then
            raise exception 'CAMPO_PROTEGIDO: % sólo lo escribe el sistema', v_col;
          end if;
        elsif p_new ->> v_col is not null then
          raise exception 'CAMPO_PROTEGIDO: % no se carga directamente; use el circuito de supervisión', v_col;
        end if;
      elsif (p_new -> v_col) is distinct from (p_old -> v_col) then
        raise exception 'CAMPO_PROTEGIDO: % no se modifica directamente; use el circuito de supervisión', v_col;
      end if;
    end loop;
    if p_op = 'INSERT' and coalesce(p_new ->> 'tipo_registro', 'fichaje_gps') <> 'fichaje_gps' then
      raise exception 'CAMPO_PROTEGIDO: un registro directo sólo puede ser un fichaje';
    end if;
    if p_op = 'UPDATE' and ((p_new -> 'tipo_registro') is distinct from (p_old -> 'tipo_registro')
                            or (p_new -> 'turno_id') is distinct from (p_old -> 'turno_id')
                            or (p_new -> 'guardia_id') is distinct from (p_old -> 'guardia_id')) then
      raise exception 'CAMPO_PROTEGIDO: tipo, turno y vigilador de un registro no se cambian directamente';
    end if;
  end if;

  -- b) ¿Es horas liquidables SIN fichaje propio, y nuevas o en aumento?
  v_manual := coalesce(p_new ->> 'tipo_registro', '') <> 'ausencia'
    and p_new ->> 'cobertura_anulada_at' is null
    and p_new ->> 'registro_anulado_at' is null
    and v_new_h > 0
    and p_new ->> 'hora_entrada_real' is null;
  if p_op = 'UPDATE' and v_manual and v_new_h <= v_old_h and p_old ->> 'hora_entrada_real' is null then
    v_manual := false;  -- no aumenta: corrección a la baja o cambio de otro campo
  end if;
  if not v_manual then
    return v_exc_old;
  end if;

  select * into v_t from public.turnos where id = (p_new ->> 'turno_id')::uuid;
  if not found then
    raise exception 'Turno inexistente para la asistencia';
  end if;
  v_guardia := coalesce((p_new ->> 'guardia_final_id')::uuid, (p_new ->> 'guardia_id')::uuid);

  -- c) Nunca dos veces el mismo intervalo: lo ya cubierto con evidencia por un
  --    reemplazo no se vuelve a liquidar al titular (ni con excepción).
  v_prog := round(extract(epoch from (v_t.fecha + v_t.hora_fin + case when v_t.hora_fin <= v_t.hora_inicio then interval '1 day' else interval '0 day' end)
                                     - (v_t.fecha + v_t.hora_inicio)) / 3600.0, 2);
  select coalesce(sum(c.horas_atribuidas), 0) into v_cubierto
  from public.turno_coberturas(v_t.id) c
  where c.rol = 'reemplazo' and c.evidencia in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor', 'excepcion_autorizada');
  if v_new_h + v_cubierto > v_prog + 0.01 then
    raise exception using
      errcode = 'P0001',
      message = format('DOBLE_LIQUIDACION: el turno ya está cubierto por un reemplazo con evidencia (%s h de %s h programadas); no se pueden liquidar %s h más al titular.',
                       v_cubierto, v_prog, v_new_h);
  end if;

  -- d) Evidencia del vigilador en el turno, o excepción autorizada vigente.
  if v_exc_old is not null then
    return v_exc_old;
  end if;
  v_ev := public.asistencia_evidencia_tipo(v_t.id, v_guardia);
  if v_ev in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor') then
    return null;
  end if;
  select e.id into v_exc
  from public.asistencia_excepciones_autorizadas e
  where e.turno_id = v_t.id and e.guardia_id = v_guardia
    and e.consumida_registro_id is null and e.vence_at > now()
  order by e.autorizado_at desc
  limit 1
  for update;
  if v_exc is null then
    raise exception using
      errcode = 'P0001',
      message = 'CONFIRMACION_SIN_EVIDENCIA: no hay fichaje, fotos ni rondas del vigilador ni una supervisión en el objetivo durante el turno. Para confirmar horas hace falta una excepción autorizada (autorizar_excepcion_asistencia) con motivo.';
  end if;
  return v_exc;
end $function$
;
revoke all on function public._registro_liquidable_validar(p_op text, p_new jsonb, p_old jsonb, p_directo boolean) from public, anon, authenticated, service_role;
grant execute on function public._registro_liquidable_validar(p_op text, p_new jsonb, p_old jsonb, p_directo boolean) to authenticated;
grant execute on function public._registro_liquidable_validar(p_op text, p_new jsonb, p_old jsonb, p_directo boolean) to service_role;

CREATE OR REPLACE FUNCTION public.acceso_habilitado_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select not exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.acceso_bloqueado)
$function$
;
revoke all on function public.acceso_habilitado_actual() from public, anon, authenticated, service_role;
grant execute on function public.acceso_habilitado_actual() to authenticated;
grant execute on function public.acceso_habilitado_actual() to service_role;

CREATE OR REPLACE FUNCTION public.actor_activo_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
     where u.auth_user_id = auth.uid()
       and u.estado = 'activo'
       and not coalesce(u.acceso_bloqueado, false)
  )
$function$
;
revoke all on function public.actor_activo_actual() from public, anon, authenticated, service_role;
grant execute on function public.actor_activo_actual() to authenticated;
grant execute on function public.actor_activo_actual() to service_role;

CREATE OR REPLACE FUNCTION public.alcance_operativo_de(p_usuario_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia') then 'todas'
    when u.puesto_organizacional = 'supervisor' then 'zonas_asignadas'
    when u.puesto_organizacional = 'vigilador' then 'propio'
    -- Fallback por rol viejo mientras puesto sea null (idéntico a lib/capacidades).
    when lower(u.rol) = 'admin' then 'todas'
    when lower(u.rol) = 'supervisor' then 'zonas_asignadas'
    else 'propio'
  end
  from public.usuarios u
  where u.id = p_usuario_id
$function$
;
revoke all on function public.alcance_operativo_de(p_usuario_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.alcance_operativo_de(p_usuario_id uuid) to authenticated;
grant execute on function public.alcance_operativo_de(p_usuario_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case public.alcance_operativo_de(p_usuario_id)
    when 'todas' then true
    when 'zonas_asignadas' then exists (
      select 1
      from public.objetivos o
      join public.supervisor_zonas sz on sz.zona_id = o.zona_id
      where o.id = p_objetivo_id
        and sz.supervisor_id = p_usuario_id
    )
    else false  -- 'propio' u desconocido: no administra objetivos por zona
  end
$function$
;
revoke all on function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) to authenticated;
grant execute on function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.alcanza_objetivo_actual(p_objetivo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)
  )
$function$
;
revoke all on function public.alcanza_objetivo_actual(p_objetivo_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.alcanza_objetivo_actual(p_objetivo_id uuid) to authenticated;
grant execute on function public.alcanza_objetivo_actual(p_objetivo_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.alcanza_supervision_actual(p_supervision_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.supervisiones s
    where s.id = p_supervision_id
      and (
        public.alcanza_objetivo_actual(s.objetivo_id)
        or (public.es_operador_actual() and s.supervisor_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid()))
      )
  )
$function$
;
revoke all on function public.alcanza_supervision_actual(p_supervision_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.alcanza_supervision_actual(p_supervision_id uuid) to authenticated;
grant execute on function public.alcanza_supervision_actual(p_supervision_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.alcanza_turno_actual(p_turno_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1
    from public.turnos t
    where t.id = p_turno_id
      and public.alcanza_objetivo_actual(t.objetivo_id)
  )
$function$
;
revoke all on function public.alcanza_turno_actual(p_turno_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.alcanza_turno_actual(p_turno_id uuid) to authenticated;
grant execute on function public.alcanza_turno_actual(p_turno_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.asistencia_evidencia_tipo(p_turno_id uuid, p_guardia_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when exists (select 1 from public.registros_asistencia r
                 where r.turno_id = p_turno_id and coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id
                   and coalesce(r.tipo_registro, '') <> 'ausencia' and r.hora_entrada_real is not null
                   and r.registro_anulado_at is null and r.cobertura_anulada_at is null) then 'fichaje'
    when exists (select 1 from public.evidencias e where e.turno_id = p_turno_id and e.guardia_id = p_guardia_id)
      or exists (select 1 from public.ronda_ejecuciones x where x.turno_id = p_turno_id and x.guardia_id = p_guardia_id
                   and x.iniciada_at is not null) then 'foto_o_ronda'
    when exists (select 1 from public.turnos t
                 join public.supervisiones s on s.objetivo_id = t.objetivo_id
                 where t.id = p_turno_id
                   and s.created_at >= (t.fecha + t.hora_inicio) at time zone 'America/Argentina/Buenos_Aires'
                   and s.created_at <= (t.fecha + t.hora_fin
                                        + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0 day' end)
                                       at time zone 'America/Argentina/Buenos_Aires') then 'constatacion_supervisor'
    when exists (select 1 from public.registros_asistencia r
                 where r.turno_id = p_turno_id and coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id
                   and r.excepcion_asistencia_id is not null
                   and r.registro_anulado_at is null and r.cobertura_anulada_at is null) then 'excepcion_autorizada'
    when exists (select 1 from public.registros_asistencia r
                 where r.turno_id = p_turno_id and coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id
                   and coalesce(r.tipo_registro, '') <> 'ausencia'
                   and r.registro_anulado_at is null and r.cobertura_anulada_at is null) then 'sin_evidencia'
    else 'sin_registro' end
$function$
;
revoke all on function public.asistencia_evidencia_tipo(p_turno_id uuid, p_guardia_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.asistencia_evidencia_tipo(p_turno_id uuid, p_guardia_id uuid) to authenticated;
grant execute on function public.asistencia_evidencia_tipo(p_turno_id uuid, p_guardia_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.calcular_horas_liquidables(p_hora_inicio time without time zone, p_hora_fin time without time zone, p_entrada time without time zone, p_salida time without time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_inicio_min      int;
  v_fin_min         int;
  v_entrada_min     int;
  v_salida_min      int;
  v_turno_nocturno  bool;
  v_min_prog        int;
  v_entrada_abs     int;
  v_salida_abs      int;
  v_min_reales      int;
  v_min_liquidables int;
begin
  if p_hora_inicio is null or p_hora_fin is null
     or p_entrada is null or p_salida is null
  then
    return null;
  end if;

  v_inicio_min  := (extract(epoch from p_hora_inicio)::int) / 60;
  v_fin_min     := (extract(epoch from p_hora_fin)::int)    / 60;
  v_entrada_min := (extract(epoch from p_entrada)::int)     / 60;
  v_salida_min  := (extract(epoch from p_salida)::int)      / 60;

  v_turno_nocturno := v_fin_min <= v_inicio_min;

  v_min_prog := case when v_turno_nocturno
                  then v_fin_min + 1440 - v_inicio_min
                  else v_fin_min - v_inicio_min
                end;

  v_entrada_abs := v_entrada_min;
  if v_turno_nocturno and v_entrada_min <= v_fin_min then
    v_entrada_abs := v_entrada_abs + 1440;
  end if;

  v_salida_abs := v_salida_min;
  if v_turno_nocturno and v_salida_min <= v_inicio_min then
    v_salida_abs := v_salida_abs + 1440;
  end if;
  if v_salida_abs < v_entrada_abs then
    v_salida_abs := v_salida_abs + 1440;
  end if;

  v_min_reales := greatest(0, v_salida_abs - v_entrada_abs);

  v_min_liquidables := case when abs(v_min_prog - v_min_reales) <= 15
                         then v_min_prog
                         else least(v_min_reales, v_min_prog)
                       end;

  return round(cast(v_min_liquidables as numeric) / 60.0, 2);
end;
$function$
;
revoke all on function public.calcular_horas_liquidables(p_hora_inicio time without time zone, p_hora_fin time without time zone, p_entrada time without time zone, p_salida time without time zone) from public, anon, authenticated, service_role;
grant execute on function public.calcular_horas_liquidables(p_hora_inicio time without time zone, p_hora_fin time without time zone, p_entrada time without time zone, p_salida time without time zone) to service_role;

CREATE OR REPLACE FUNCTION public.es_gerencia_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  )
$function$
;
revoke all on function public.es_gerencia_actual() from public, anon, authenticated, service_role;
grant execute on function public.es_gerencia_actual() to authenticated;
grant execute on function public.es_gerencia_actual() to service_role;

CREATE OR REPLACE FUNCTION public.es_operador_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')) )
  )
$function$
;
revoke all on function public.es_operador_actual() from public, anon, authenticated, service_role;
grant execute on function public.es_operador_actual() to authenticated;
grant execute on function public.es_operador_actual() to service_role;

CREATE OR REPLACE FUNCTION public.puede_acceder_gerencia_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select public.es_gerencia_actual() or public.tiene_delegacion_gerencia_actual()
$function$
;
revoke all on function public.puede_acceder_gerencia_actual() from public, anon, authenticated, service_role;
grant execute on function public.puede_acceder_gerencia_actual() to authenticated;
grant execute on function public.puede_acceder_gerencia_actual() to service_role;

CREATE OR REPLACE FUNCTION public.puede_configurar_sistema_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('direccion_operativa','administracion','gerencia')
            or u.acceso_admin_pleno = true
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  )
$function$
;
revoke all on function public.puede_configurar_sistema_actual() from public, anon, authenticated, service_role;
grant execute on function public.puede_configurar_sistema_actual() to authenticated;
grant execute on function public.puede_configurar_sistema_actual() to service_role;

CREATE OR REPLACE FUNCTION public.puede_gestionar_personal_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$function$
;
revoke all on function public.puede_gestionar_personal_actual() from public, anon, authenticated, service_role;
grant execute on function public.puede_gestionar_personal_actual() to authenticated;
grant execute on function public.puede_gestionar_personal_actual() to service_role;

CREATE OR REPLACE FUNCTION public.puede_gestionar_roles_normales_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$function$
;
revoke all on function public.puede_gestionar_roles_normales_actual() from public, anon, authenticated, service_role;
grant execute on function public.puede_gestionar_roles_normales_actual() to authenticated;
grant execute on function public.puede_gestionar_roles_normales_actual() to service_role;

CREATE OR REPLACE FUNCTION public.puede_gestionar_usuarios_roles_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$function$
;
revoke all on function public.puede_gestionar_usuarios_roles_actual() from public, anon, authenticated, service_role;
grant execute on function public.puede_gestionar_usuarios_roles_actual() to authenticated;
grant execute on function public.puede_gestionar_usuarios_roles_actual() to service_role;

CREATE OR REPLACE FUNCTION public.puede_liquidar_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion')
$function$
;
revoke all on function public.puede_liquidar_actual() from public, anon, authenticated, service_role;
grant execute on function public.puede_liquidar_actual() to authenticated;
grant execute on function public.puede_liquidar_actual() to service_role;

CREATE OR REPLACE FUNCTION public.registros_asistencia_validar_liquidable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  new.excepcion_asistencia_id := public._registro_liquidable_validar(
    tg_op, to_jsonb(new), case when tg_op = 'UPDATE' then to_jsonb(old) end,
    current_user in ('authenticated', 'anon'));
  return new;
end $function$
;
revoke all on function public.registros_asistencia_validar_liquidable() from public, anon, authenticated, service_role;
grant execute on function public.registros_asistencia_validar_liquidable() to authenticated;
grant execute on function public.registros_asistencia_validar_liquidable() to public;
grant execute on function public.registros_asistencia_validar_liquidable() to service_role;

CREATE OR REPLACE FUNCTION public.rondas_usuario_actual_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select u.id
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1
$function$
;
revoke all on function public.rondas_usuario_actual_id() from public, anon, authenticated, service_role;
grant execute on function public.rondas_usuario_actual_id() to authenticated;
grant execute on function public.rondas_usuario_actual_id() to service_role;

CREATE OR REPLACE FUNCTION public.tiene_acceso_admin_pleno_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.acceso_admin_pleno = true
  )
$function$
;
revoke all on function public.tiene_acceso_admin_pleno_actual() from public, anon, authenticated, service_role;
grant execute on function public.tiene_acceso_admin_pleno_actual() to authenticated;
grant execute on function public.tiene_acceso_admin_pleno_actual() to service_role;

CREATE OR REPLACE FUNCTION public.tiene_delegacion_gerencia(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.gerencia_delegaciones d
    where d.usuario_id = p_usuario_id
      and d.activo = true
      and d.revocado_at is null
      and d.desde <= now()
      and (d.hasta is null or d.hasta > now())
  )
$function$
;
revoke all on function public.tiene_delegacion_gerencia(p_usuario_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.tiene_delegacion_gerencia(p_usuario_id uuid) to authenticated;
grant execute on function public.tiene_delegacion_gerencia(p_usuario_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.tiene_delegacion_gerencia_actual()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.tiene_delegacion_gerencia(u.id)
  )
$function$
;
revoke all on function public.tiene_delegacion_gerencia_actual() from public, anon, authenticated, service_role;
grant execute on function public.tiene_delegacion_gerencia_actual() to authenticated;
grant execute on function public.tiene_delegacion_gerencia_actual() to service_role;

CREATE OR REPLACE FUNCTION public.turno_coberturas(p_turno_id uuid)
 RETURNS TABLE(turno_id uuid, guardia_id uuid, rol text, evidencia text, minutos_solapados integer, horas_liquidables numeric, horas_atribuidas numeric, inicio timestamp without time zone, fin timestamp without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with b as (
    select t.*, (t.fecha + t.hora_inicio) as ini,
           (t.fecha + t.hora_fin + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0 day' end) as fin_b
    from public.turnos t where t.id = p_turno_id
  ),
  c as (
    select t2.id, t2.guardia_id,
           greatest(b.ini, t2.fecha + t2.hora_inicio) as i,
           least(b.fin_b, t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end) as f,
           extract(epoch from (t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end)
                              - (t2.fecha + t2.hora_inicio)) / 60.0 as dur2
    from b
    join public.turnos t2
      on t2.id <> b.id
     and t2.guardia_id is not null
     and t2.guardia_id is distinct from b.guardia_id
     and coalesce(t2.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
     and ((b.puesto_id is not null and t2.puesto_id = b.puesto_id)
          or (b.puesto_id is null and t2.puesto_id is null and t2.objetivo_id = b.objetivo_id))
     and t2.fecha between b.fecha - 1 and b.fecha + 1
     and (t2.fecha + t2.hora_inicio) < b.fin_b
     and b.ini < (t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end)
     and (t2.reemplaza_turno_id = b.id
          or (t2.reemplaza_turno_id is null
              and t2.created_at > b.created_at + interval '5 minutes'
              and t2.created_at > ((b.fecha + b.hora_inicio) at time zone 'America/Argentina/Buenos_Aires') - interval '12 hours'))
  )
  select b.id, b.guardia_id, 'titular'::text,
         case when b.guardia_id is null then 'sin_registro' else public.asistencia_evidencia_tipo(b.id, b.guardia_id) end,
         (extract(epoch from b.fin_b - b.ini) / 60)::integer,
         public.turno_horas_liquidadas(b.id, b.guardia_id),
         public.turno_horas_liquidadas(b.id, b.guardia_id),
         b.ini, b.fin_b
  from b
  union all
  select c.id, c.guardia_id, 'reemplazo'::text,
         public.asistencia_evidencia_tipo(c.id, c.guardia_id),
         (extract(epoch from c.f - c.i) / 60)::integer,
         public.turno_horas_liquidadas(c.id, c.guardia_id),
         round(public.turno_horas_liquidadas(c.id, c.guardia_id) * (extract(epoch from c.f - c.i) / 60.0) / nullif(c.dur2, 0), 2),
         c.i, c.f
  from c
$function$
;
revoke all on function public.turno_coberturas(p_turno_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.turno_coberturas(p_turno_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.turno_horas_liquidadas(p_turno_id uuid, p_guardia_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_t public.turnos%rowtype;
  v_r public.registros_asistencia%rowtype;
  v_ent time;
  v_sal time;
begin
  select * into v_t from public.turnos where id = p_turno_id;
  if not found or coalesce(v_t.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    return 0;
  end if;
  select r.* into v_r
  from public.registros_asistencia r
  where r.turno_id = p_turno_id
    and coalesce(r.tipo_registro, '') <> 'ausencia'
    and r.registro_anulado_at is null
    and (p_guardia_id is null or coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id)
  order by
    case when r.cobertura_anulada_at is not null then -1000 else
      (case when r.horas_liquidables is not null then 100 else 0 end)
      + (case when r.hora_entrada_final is not null or r.hora_salida_final is not null then 40 else 0 end)
      + (case when r.hora_entrada_real is not null then 10 else 0 end)
      + (case when r.hora_salida_real is not null then 5 else 0 end)
      + least(coalesce(r.horas_trabajadas, 0), 24) end desc,
    (coalesce(r.hora_salida_final, r.hora_salida_real) is not null) desc,
    (coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null) desc,
    coalesce(r.horas_liquidables, 0) desc,
    r.id::text
  limit 1;
  if not found or v_r.cobertura_anulada_at is not null then
    return 0;
  end if;
  if v_r.horas_liquidables is not null then
    return round(greatest(0, v_r.horas_liquidables) * 2) / 2;
  end if;
  if v_r.hora_entrada_final is not null or v_r.hora_salida_final is not null then
    v_ent := coalesce(v_r.hora_entrada_final, v_r.hora_entrada_real);
    v_sal := coalesce(v_r.hora_salida_final, v_r.hora_salida_real);
    if v_ent is null or v_sal is null then return 0; end if;
    return round(coalesce(public.calcular_horas_liquidables(v_t.hora_inicio, v_t.hora_fin, v_ent, v_sal), 0) * 2) / 2;
  end if;
  if v_r.hora_entrada_real is not null and v_r.hora_salida_real is not null then
    return coalesce(public.calcular_horas_liquidables(v_t.hora_inicio, v_t.hora_fin, v_t.hora_inicio, v_t.hora_fin), 0);
  end if;
  return 0;
end $function$
;
revoke all on function public.turno_horas_liquidadas(p_turno_id uuid, p_guardia_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.turno_horas_liquidadas(p_turno_id uuid, p_guardia_id uuid) to authenticated;
grant execute on function public.turno_horas_liquidadas(p_turno_id uuid, p_guardia_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
revoke all on function public.update_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.update_updated_at() to anon;
grant execute on function public.update_updated_at() to authenticated;
grant execute on function public.update_updated_at() to public;
grant execute on function public.update_updated_at() to service_role;

CREATE OR REPLACE FUNCTION public.usuarios_acceso_facturacion_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.acceso_facturacion, false) and not public.es_gerencia_actual() then
      raise exception 'Sólo Gerencia puede otorgar acceso a Facturación' using errcode = '42501';
    end if;
  elsif new.acceso_facturacion is distinct from old.acceso_facturacion and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede cambiar el acceso a Facturación' using errcode = '42501';
  end if;
  return new;
end $function$
;
revoke all on function public.usuarios_acceso_facturacion_guard() from public, anon, authenticated, service_role;
grant execute on function public.usuarios_acceso_facturacion_guard() to service_role;

CREATE OR REPLACE FUNCTION public.usuarios_guarda_acceso_bloqueado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if (new.acceso_bloqueado is distinct from old.acceso_bloqueado
      or new.acceso_bloqueado_motivo is distinct from old.acceso_bloqueado_motivo)
     and coalesce(current_setting('mercosur.baja_rpc', true), '') <> '1' then
    raise exception 'El acceso bloqueado por una baja sólo se cambia desde el procedimiento de baja' using errcode = '42501';
  end if;
  if new.acceso_bloqueado and new.estado = 'activo' and old.estado is distinct from 'activo' then
    raise exception 'Tiene una baja confirmada con el acceso bloqueado: Gerencia debe rehabilitar el acceso primero' using errcode = '42501';
  end if;
  return new;
end;
$function$
;
revoke all on function public.usuarios_guarda_acceso_bloqueado() from public, anon, authenticated, service_role;
grant execute on function public.usuarios_guarda_acceso_bloqueado() to authenticated;
grant execute on function public.usuarios_guarda_acceso_bloqueado() to public;
grant execute on function public.usuarios_guarda_acceso_bloqueado() to service_role;

CREATE OR REPLACE FUNCTION public.usuarios_proteger_campos_criticos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if (new.puesto_organizacional = 'gerencia')
       or (new.puesto_organizacional is null and new.rol is not null and lower(new.rol) = 'admin') then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede crear usuarios con nivel gerencia o admin sin puesto';
      end if;
    elsif (new.rol is not null and lower(new.rol) in ('admin','supervisor'))
          or new.puesto_organizacional is not null then
      if not public.puede_gestionar_roles_normales_actual() then
        raise exception 'No autorizado a asignar rol/puesto en el alta';
      end if;
    end if;
    if new.cuenta_bancaria is not null then
      if not public.puede_acceder_gerencia_actual() then
        raise exception 'Sólo Gerencia (o delegación gerencial) puede cargar datos bancarios';
      end if;
    end if;
    if coalesce(new.acceso_admin_pleno, false) = true then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede otorgar acceso_admin_pleno';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.rol is distinct from old.rol or new.puesto_organizacional is distinct from old.puesto_organizacional then
      if (new.puesto_organizacional = 'gerencia' or old.puesto_organizacional = 'gerencia')
         or (new.puesto_organizacional is null and new.rol is not null and lower(new.rol) = 'admin') then
        if not public.es_gerencia_actual() then
          raise exception 'Sólo Gerencia puede asignar/quitar el nivel gerencia o admin sin puesto';
        end if;
      else
        if not public.puede_gestionar_roles_normales_actual() then
          raise exception 'No autorizado a cambiar rol o puesto_organizacional';
        end if;
      end if;
    end if;
    if new.cuenta_bancaria is distinct from old.cuenta_bancaria then
      if not public.puede_acceder_gerencia_actual() then
        raise exception 'Sólo Gerencia (o delegación gerencial) puede modificar la cuenta bancaria';
      end if;
    end if;
    if new.acceso_admin_pleno is distinct from old.acceso_admin_pleno then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede cambiar acceso_admin_pleno';
      end if;
    end if;
    if new.auth_user_id is distinct from old.auth_user_id then
      if not ( public.puede_gestionar_roles_normales_actual() or new.auth_user_id = auth.uid() ) then
        raise exception 'No autorizado a cambiar auth_user_id';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$function$
;
revoke all on function public.usuarios_proteger_campos_criticos() from public, anon, authenticated, service_role;
grant execute on function public.usuarios_proteger_campos_criticos() to service_role;
