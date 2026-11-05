-- Rollback de 20261205100100_quitar_pausar_ronda_sin_causa.sql
--
-- Recrea pausar_ronda(uuid, text, timestamptz) con la definición viva de
-- producción del 04/11/2026 (pg_get_functiondef; md5(prosrc)
-- ee6705d7c2857aedf9d90b26af3b1877, cuerpo con CRLF) y con los mismos
-- permisos que tenía: {postgres=X, service_role=X}.
begin;

do $do$ begin execute replace(replace($def$
CREATE OR REPLACE FUNCTION public.pausar_ronda(p_ronda_base_id uuid, p_motivo text, p_hasta_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid         uuid := auth.uid();
  v_usuario_id  uuid;
  v_objetivo_id uuid;
  v_puesto_id   uuid;
  v_pausa       record;
  v_alertas_ant bigint;
begin
  if v_uid is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo';
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select rb.objetivo_id, rb.puesto_id
    into v_objetivo_id, v_puesto_id
  from public.rondas_base rb
  where rb.id = p_ronda_base_id and rb.activo;
  if v_objetivo_id is null then
    return jsonb_build_object('contexto', 'ronda_no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  if length(trim(coalesce(p_motivo, ''))) < 5 then
    return jsonb_build_object('contexto', 'motivo_invalido');
  end if;

  if p_hasta_at is not null and p_hasta_at <= now() then
    return jsonb_build_object('contexto', 'hasta_invalido');
  end if;

  if exists (
    select 1 from public.ronda_pausas
    where ronda_base_id = p_ronda_base_id and activa = true
  ) then
    return jsonb_build_object('contexto', 'ya_pausada');
  end if;

  insert into public.ronda_pausas (
    ronda_base_id, objetivo_id, puesto_id, pausada_por, motivo, hasta_at
  ) values (
    p_ronda_base_id, v_objetivo_id, v_puesto_id, v_usuario_id, trim(p_motivo), p_hasta_at
  )
  returning * into v_pausa;

  select count(*) into v_alertas_ant
  from public.ronda_alertas
  where ronda_base_id = p_ronda_base_id
    and estado = 'pendiente';

  return jsonb_build_object(
    'contexto', 'ok',
    'pausa', jsonb_build_object(
      'id',              v_pausa.id,
      'ronda_base_id',   v_pausa.ronda_base_id,
      'objetivo_id',     v_pausa.objetivo_id,
      'puesto_id',       v_pausa.puesto_id,
      'pausada_por',     v_pausa.pausada_por,
      'pausada_por_nombre', (
        select u.apellido || ', ' || u.nombre
        from public.usuarios u where u.id = v_usuario_id
      ),
      'pausada_at',      v_pausa.pausada_at,
      'motivo',          v_pausa.motivo,
      'hasta_at',        v_pausa.hasta_at,
      'activa',          v_pausa.activa
    ),
    'alertas_pendientes_anteriores', v_alertas_ant
  );
end;
$function$
$def$, E'\r\n', E'\n'), E'\n', E'\r\n'); end $do$;

revoke all on function public.pausar_ronda(uuid, text, timestamptz) from public;
revoke all on function public.pausar_ronda(uuid, text, timestamptz) from anon;
revoke all on function public.pausar_ronda(uuid, text, timestamptz) from authenticated;
grant execute on function public.pausar_ronda(uuid, text, timestamptz) to service_role;

commit;
