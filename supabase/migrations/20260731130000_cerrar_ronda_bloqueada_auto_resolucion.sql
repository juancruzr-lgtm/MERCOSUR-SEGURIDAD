-- ============================================================================
-- ALERTAS DE RONDAS · A2 — cerrar_ronda_bloqueada auto-resuelve la no_finalizada
-- ============================================================================
--
-- Recrea cerrar_ronda_bloqueada (idéntica a 20260729000000) agregando, tras el
-- cierre de la ejecución, la auto-resolución de la alerta no_finalizada asociada:
--   estado='resuelta', accion='cierre_administrativo', supervisor, fecha, motivo,
--   ejecucion_id — dejando constancia en el historial. No borra la alerta ni la
--   convierte en cumplimiento normal. NO resuelve alertas no_iniciada.
--
-- Todo lo demás (permisos, idempotencia, omitir pendientes, resultado) queda
-- exactamente igual. No toca horas liquidables, asistencia ni JWM.

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
   where u.auth_user_id = auth.uid()
     and u.estado = 'activo'
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
        'id',             v_ejecucion.id,
        'estado',         v_ejecucion.estado,
        'resultado',      v_ejecucion.resultado,
        'cerrada_at',     v_ejecucion.cerrada_at,
        'cerrada_motivo', v_ejecucion.cerrada_motivo
      )
    );
  end if;

  if v_ejecucion.estado <> 'en_curso' then
    return jsonb_build_object('contexto', 'ejecucion_no_bloqueada', 'ejecucion', null);
  end if;

  v_motivo := btrim(coalesce(p_motivo, ''));
  if length(v_motivo) < 10 then
    return jsonb_build_object('contexto', 'motivo_invalido', 'ejecucion', null);
  end if;

  update public.ronda_ejecucion_puntos
     set estado        = 'omitido',
         registrado_at = now()
   where ronda_ejecucion_id = v_ejecucion.id
     and estado = 'pendiente';

  get diagnostics v_omitidos = row_count;

  select count(*) into v_conservados
    from public.ronda_ejecucion_puntos ep
   where ep.ronda_ejecucion_id = v_ejecucion.id
     and ep.estado <> 'omitido';

  update public.ronda_ejecuciones
     set estado         = 'finalizada',
         resultado      = 'incompleta',
         finalizada_at  = now(),
         cerrada_por    = v_usuario_id,
         cerrada_at     = now(),
         cerrada_motivo = v_motivo
   where id = v_ejecucion.id
     and estado = 'en_curso';

  -- ── Auto-resolución de la alerta no_finalizada asociada a esta ejecución ──
  -- Solo no_finalizada pendiente. No toca no_iniciada ni alertas ya resueltas.
  -- La tabla ronda_alertas puede no existir en instalaciones que aún no
  -- aplicaron A1: el bloque se protege para no romper el cierre.
  if to_regclass('public.ronda_alertas') is not null then
    with resueltas as (
      update public.ronda_alertas a
         set estado       = 'resuelta',
             resuelta_por = v_usuario_id,
             resuelta_at  = now(),
             accion       = 'cierre_administrativo',
             comentario   = v_motivo,
             updated_at   = now()
       where a.ejecucion_id = v_ejecucion.id
         and a.tipo   = 'no_finalizada'
         and a.estado = 'pendiente'
      returning a.id
    )
    insert into public.ronda_alerta_intervenciones
      (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
    select r.id, v_usuario_id, 'cierre_administrativo', v_motivo, 'pendiente', 'resuelta'
    from resueltas r;
  end if;

  return jsonb_build_object(
    'contexto', 'cerrada',
    'ejecucion', jsonb_build_object(
      'id',                v_ejecucion.id,
      'estado',            'finalizada',
      'resultado',         'incompleta',
      'puntos_omitidos',   v_omitidos,
      'puntos_conservados', v_conservados,
      'cerrada_motivo',    v_motivo
    )
  );
end;
$$;

revoke all on function public.cerrar_ronda_bloqueada(uuid, text) from public;
revoke all on function public.cerrar_ronda_bloqueada(uuid, text) from anon;
grant execute on function public.cerrar_ronda_bloqueada(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
