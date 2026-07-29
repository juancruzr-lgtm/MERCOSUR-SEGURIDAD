-- ROLLBACK de 20260731130000: restaura cerrar_ronda_bloqueada SIN auto-resolución
-- (versión idéntica a 20260729000000_rondas_cierre_bloqueada.sql). Ejecutar ANTES
-- de dropear ronda_alertas (rollback de A1).
begin;

create or replace function public.cerrar_ronda_bloqueada(
  p_ejecucion_id uuid,
  p_motivo       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario_id  uuid;
  v_ejecucion   record;
  v_motivo      text;
  v_omitidos    integer := 0;
  v_conservados integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select u.id into v_usuario_id
    from public.usuarios u
   where u.auth_user_id = auth.uid() and u.estado = 'activo'
   limit 1;
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'ejecucion', null);
  end if;

  if p_ejecucion_id is null then
    return jsonb_build_object('contexto', 'ejecucion_no_encontrada', 'ejecucion', null);
  end if;

  select e.* into v_ejecucion
    from public.ronda_ejecuciones e
   where e.id = p_ejecucion_id
     for update;
  if not found then
    return jsonb_build_object('contexto', 'ejecucion_no_encontrada', 'ejecucion', null);
  end if;

  if not public.puede_administrar_rondas_objetivo(v_ejecucion.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'ejecucion', null);
  end if;

  if v_ejecucion.cerrada_por is not null then
    return jsonb_build_object(
      'contexto', 'ya_cerrada',
      'ejecucion', jsonb_build_object(
        'id', v_ejecucion.id, 'estado', v_ejecucion.estado, 'resultado', v_ejecucion.resultado,
        'cerrada_at', v_ejecucion.cerrada_at, 'cerrada_motivo', v_ejecucion.cerrada_motivo));
  end if;

  if v_ejecucion.estado <> 'en_curso' then
    return jsonb_build_object('contexto', 'ejecucion_no_bloqueada', 'ejecucion', null);
  end if;

  v_motivo := btrim(coalesce(p_motivo, ''));
  if length(v_motivo) < 10 then
    return jsonb_build_object('contexto', 'motivo_invalido', 'ejecucion', null);
  end if;

  update public.ronda_ejecucion_puntos
     set estado = 'omitido', registrado_at = now()
   where ronda_ejecucion_id = v_ejecucion.id and estado = 'pendiente';
  get diagnostics v_omitidos = row_count;

  select count(*) into v_conservados
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = v_ejecucion.id and ep.estado <> 'omitido';

  update public.ronda_ejecuciones
     set estado = 'finalizada', resultado = 'incompleta', finalizada_at = now(),
         cerrada_por = v_usuario_id, cerrada_at = now(), cerrada_motivo = v_motivo
   where id = v_ejecucion.id and estado = 'en_curso';

  return jsonb_build_object(
    'contexto', 'cerrada',
    'ejecucion', jsonb_build_object(
      'id', v_ejecucion.id, 'estado', 'finalizada', 'resultado', 'incompleta',
      'puntos_omitidos', v_omitidos, 'puntos_conservados', v_conservados, 'cerrada_motivo', v_motivo));
end;
$$;

revoke all on function public.cerrar_ronda_bloqueada(uuid, text) from public;
revoke all on function public.cerrar_ronda_bloqueada(uuid, text) from anon;
grant execute on function public.cerrar_ronda_bloqueada(uuid, text) to authenticated;
notify pgrst, 'reload schema';
commit;
