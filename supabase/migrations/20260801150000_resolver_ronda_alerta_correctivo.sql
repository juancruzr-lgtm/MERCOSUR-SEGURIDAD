-- ============================================================================
-- RONDAS · resolver_ronda_alerta — el cierre administrativo ahora sí resuelve
-- ============================================================================
--
-- DEFECTO CORREGIDO
--
-- `resolver_ronda_alerta(..., 'cierre_administrativo', ...)` delega en
-- `cerrar_ronda_bloqueada()` y devuelve 'resuelta' cuando el cierre sale bien.
-- Pero `cerrar_ronda_bloqueada()` auto-resuelve ÚNICAMENTE las alertas de tipo
-- `no_finalizada` (20260731130000, cláusula `a.tipo = 'no_finalizada'`).
--
-- Una alerta `no_iniciada` con inicio tardío tiene `ejecucion_id` no nulo —el
-- evaluador asocia la ejecución tardía—, así que la UI ofrece la acción
-- (RondaAlertasPanel filtra por `ejecucion_id !== null`). El supervisor la
-- elegía, el cliente recibía 'resuelta', `mensajeContextoResolverAlerta`
-- devolvía null, el modal se cerraba como éxito… y la alerta seguía pendiente.
-- Lo mismo con `suspendida`. Efecto: pendientes que el supervisor cree haber
-- cerrado y vuelven a aparecer, sin ninguna señal de error.
--
-- Corrección: después de un cierre exitoso, si ESTA alerta sigue pendiente
-- (porque no era `no_finalizada`), se resuelve explícitamente y se registra su
-- intervención. La función nunca más devuelve 'resuelta' dejando la alerta
-- abierta.
--
-- Se conserva sin cambios: el vocabulario de contextos, la exigencia de
-- comentario, la idempotencia sobre alertas ya resueltas, el bloqueo `for
-- update`, el historial append-only y los grants.
-- No toca `cerrar_ronda_bloqueada` (sigue siendo la única vía de cierre de una
-- ejecución), ni asistencia, liquidables o JWM.

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
  v_pendiente  boolean;
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

  -- Serializa dos supervisores sobre la misma alerta.
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

  -- Idempotencia: una alerta ya resuelta no se reabre ni se re-registra.
  if v_alerta.estado = 'resuelta' then
    return jsonb_build_object('contexto', 'ya_resuelta', 'alerta_id', v_alerta.id);
  end if;

  -- ── Cierre administrativo: la ejecución se cierra por su única vía.
  if p_accion = 'cierre_administrativo' then
    if v_alerta.ejecucion_id is null then
      return jsonb_build_object('contexto', 'cierre_no_aplicable', 'alerta_id', v_alerta.id);
    end if;

    v_cerrar := public.cerrar_ronda_bloqueada(v_alerta.ejecucion_id, v_comentario);
    v_cerrar_ctx := v_cerrar->>'contexto';

    if v_cerrar_ctx not in ('cerrada', 'ya_cerrada') then
      -- Propaga el motivo por el que no se pudo cerrar (motivo_invalido,
      -- ejecucion_no_bloqueada, sin_permiso, ejecucion_no_encontrada, …).
      return jsonb_build_object('contexto', v_cerrar_ctx, 'alerta_id', v_alerta.id);
    end if;

    -- `cerrar_ronda_bloqueada` solo auto-resuelve las `no_finalizada`. Si esta
    -- alerta es `no_iniciada` o `suspendida` sigue pendiente: se cierra acá,
    -- con su propia intervención, para que el 'resuelta' que devolvemos sea cierto.
    select (a.estado = 'pendiente') into v_pendiente
    from public.ronda_alertas a
    where a.id = v_alerta.id;

    if v_pendiente then
      insert into public.ronda_alerta_intervenciones
        (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
      values
        (v_alerta.id, v_usuario_id, 'cierre_administrativo', v_comentario, 'pendiente', 'resuelta');

      update public.ronda_alertas
         set estado       = 'resuelta',
             resuelta_por = v_usuario_id,
             resuelta_at  = now(),
             accion       = 'cierre_administrativo',
             comentario   = v_comentario,
             updated_at   = now()
       where id = v_alerta.id;
    end if;

    return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
  end if;

  -- ── Acciones que NO cierran: llamada_vigilador / solicitud_cumplimiento.
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

  -- ── Acciones que cierran directamente: justificacion / resuelta.
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
