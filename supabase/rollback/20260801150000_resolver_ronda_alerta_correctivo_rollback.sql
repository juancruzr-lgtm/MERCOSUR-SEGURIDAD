-- ============================================================================
-- ROLLBACK de 20260801150000_resolver_ronda_alerta_correctivo
-- ============================================================================
--
-- Restituye `resolver_ronda_alerta()` exactamente como la dejó
-- 20260731120000_ronda_alertas_rpc.sql.
--
-- CONSECUENCIA CONOCIDA de volver atrás: reaparece el defecto — un cierre
-- administrativo sobre una alerta `no_iniciada` o `suspendida` devuelve
-- 'resuelta' al cliente pero deja la alerta en 'pendiente', sin señal de error.
-- Las alertas ya resueltas por la versión corregida NO se reabren.

begin;

create or replace function public.resolver_ronda_alerta(
  p_alerta_id  uuid,
  p_accion     text,
  p_comentario text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_usuario_id uuid;
  v_alerta     record;
  v_comentario text := btrim(coalesce(p_comentario, ''));
  v_cerrar     jsonb;
  v_cerrar_ctx text;
  v_cierra     boolean;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1;
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  if p_accion not in ('llamada_vigilador', 'solicitud_cumplimiento',
                      'justificacion', 'cierre_administrativo', 'resuelta') then
    return jsonb_build_object('contexto', 'accion_invalida');
  end if;

  select * into v_alerta
  from public.ronda_alertas
  where id = p_alerta_id
  for update;
  if not found then
    return jsonb_build_object('contexto', 'no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_alerta.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  v_cierra := p_accion in ('justificacion', 'cierre_administrativo', 'resuelta');

  if v_cierra and v_comentario = '' then
    return jsonb_build_object('contexto', 'comentario_requerido');
  end if;

  if v_alerta.estado = 'resuelta' then
    return jsonb_build_object('contexto', 'ya_resuelta', 'alerta_id', v_alerta.id);
  end if;

  if p_accion = 'cierre_administrativo' then
    if v_alerta.ejecucion_id is null then
      return jsonb_build_object('contexto', 'cierre_no_aplicable', 'alerta_id', v_alerta.id);
    end if;

    v_cerrar := public.cerrar_ronda_bloqueada(v_alerta.ejecucion_id, v_comentario);
    v_cerrar_ctx := v_cerrar->>'contexto';

    if v_cerrar_ctx in ('cerrada', 'ya_cerrada') then
      return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
    end if;
    return jsonb_build_object('contexto', v_cerrar_ctx, 'alerta_id', v_alerta.id);
  end if;

  if not v_cierra then
    insert into public.ronda_alerta_intervenciones
      (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
    values
      (v_alerta.id, v_usuario_id, p_accion, nullif(v_comentario, ''), 'pendiente', 'pendiente');

    update public.ronda_alertas
       set accion     = p_accion,
           comentario = nullif(v_comentario, ''),
           updated_at = now()
     where id = v_alerta.id;

    return jsonb_build_object('contexto', 'registrada', 'alerta_id', v_alerta.id);
  end if;

  insert into public.ronda_alerta_intervenciones
    (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
  values
    (v_alerta.id, v_usuario_id, p_accion, v_comentario, 'pendiente', 'resuelta');

  update public.ronda_alertas
     set estado       = 'resuelta',
         resuelta_por = v_usuario_id,
         resuelta_at  = now(),
         accion       = p_accion,
         comentario   = v_comentario,
         updated_at   = now()
   where id = v_alerta.id;

  return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
end;
$$;

revoke all on function public.resolver_ronda_alerta(uuid, text, text) from public;
revoke all on function public.resolver_ronda_alerta(uuid, text, text) from anon;
grant execute on function public.resolver_ronda_alerta(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
