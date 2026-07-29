-- ============================================================================
-- ALERTAS DE RONDAS · A2 — RPCs de listado e intervención/resolución
-- ============================================================================
--
-- listar_ronda_alertas_objetivo(objetivo, estado?) — lectura autorizada por zona.
-- resolver_ronda_alerta(alerta, accion, comentario) — registra la intervención
--   en el historial y actualiza el estado según las reglas aprobadas:
--     · llamada_vigilador / solicitud_cumplimiento  → NO cierran la alerta
--     · justificacion / resuelta                     → cierran la alerta
--     · cierre_administrativo                        → delega en
--       cerrar_ronda_bloqueada (única vía de cierre de la ejecución); esa función
--       auto-resuelve la alerta no_finalizada asociada (ver migración A2/cierre).
--   Comentario obligatorio para justificacion, cierre_administrativo y resuelta.
--   Se conserva el historial completo (no solo la última intervención).

begin;

-- ── Listado ─────────────────────────────────────────────────────────────────

create or replace function public.listar_ronda_alertas_objetivo(
  p_objetivo_id uuid,
  p_estado      text default null       -- null = todas; 'pendiente' | 'resuelta'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'alertas', jsonb_build_array());
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'alertas', jsonb_build_array());
  end if;

  if p_estado is not null and p_estado not in ('pendiente', 'resuelta') then
    return jsonb_build_object('contexto', 'parametro_invalido', 'alertas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'alertas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',              a.id,
          'tipo',            a.tipo,
          'estado',          a.estado,
          'objetivo_id',     a.objetivo_id,
          'puesto_id',       a.puesto_id,
          'puesto_nombre',   pu.nombre,
          'ronda_base_id',   a.ronda_base_id,
          'ronda_nombre',    rb.nombre,
          'turno_id',        a.turno_id,
          'guardia_id',      a.guardia_id,
          'guardia_nombre',  g.apellido || ', ' || g.nombre,
          'ejecucion_id',    a.ejecucion_id,
          'ventana_inicio',  a.ventana_inicio,
          'ventana_fin',     a.ventana_fin,
          'vencimiento_at',  a.vencimiento_at,
          'detectada_at',    a.detectada_at,
          'resuelta_por',    a.resuelta_por,
          'resuelta_por_nombre', case when a.resuelta_por is null then null
                                      else rp.apellido || ', ' || rp.nombre end,
          'resuelta_at',     a.resuelta_at,
          'accion',          a.accion,
          'comentario',      a.comentario,
          'intervenciones',  (select count(*) from public.ronda_alerta_intervenciones i
                                where i.ronda_alerta_id = a.id)
        )
        order by a.detectada_at desc
      )
      from public.ronda_alertas a
      join public.rondas_base rb on rb.id = a.ronda_base_id
      join public.puestos    pu on pu.id = a.puesto_id
      join public.usuarios    g on  g.id = a.guardia_id
      left join public.usuarios rp on rp.id = a.resuelta_por
      where a.objetivo_id = p_objetivo_id
        and (p_estado is null or a.estado = p_estado)
    ), jsonb_build_array())
  );
end;
$$;

revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from public;
revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from anon;
grant execute on function public.listar_ronda_alertas_objetivo(uuid, text) to authenticated;

-- ── Intervención / resolución ───────────────────────────────────────────────

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

  -- ── Cierre administrativo: se delega en la única vía de cierre de ejecución.
  --    cerrar_ronda_bloqueada auto-resuelve la alerta no_finalizada y registra
  --    la intervención de cierre. Una no_iniciada sin ejecución no aplica.
  if p_accion = 'cierre_administrativo' then
    if v_alerta.ejecucion_id is null then
      return jsonb_build_object('contexto', 'cierre_no_aplicable', 'alerta_id', v_alerta.id);
    end if;

    v_cerrar := public.cerrar_ronda_bloqueada(v_alerta.ejecucion_id, v_comentario);
    v_cerrar_ctx := v_cerrar->>'contexto';

    if v_cerrar_ctx in ('cerrada', 'ya_cerrada') then
      return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
    end if;
    -- Propaga el motivo por el que no se pudo cerrar (motivo_invalido,
    -- ejecucion_no_bloqueada, sin_permiso, ejecucion_no_encontrada, …).
    return jsonb_build_object('contexto', v_cerrar_ctx, 'alerta_id', v_alerta.id);
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
