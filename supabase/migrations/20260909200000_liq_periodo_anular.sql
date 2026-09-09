-- ============================================================================
-- LIQ · Eliminar / anular períodos de liquidación (parche UX prioritario)
-- ============================================================================
-- ROLLBACK: supabase/rollback/20260909200000_liq_periodo_anular_rollback.sql
--
-- Regla: un período SIN historia relevante (sin ajustes/importaciones/
-- consolidación/envío/resultado Visual) puede borrarse físicamente. Si tiene
-- historia, NO se borra: se ANULA (soft) para no perder información. La UI pide
-- confirmación fuerte mostrando el contenido antes de anular.
-- ============================================================================

-- 1) Nuevo estado 'anulado'.
alter table public.liquidacion_periodo drop constraint if exists liquidacion_periodo_estado_check;
alter table public.liquidacion_periodo
  add constraint liquidacion_periodo_estado_check
  check (estado = any (array['borrador','revision','consolidada','exportada','liquidada','anulado']));

alter table public.liquidacion_periodo add column if not exists anulado_at     timestamptz;
alter table public.liquidacion_periodo add column if not exists anulado_por    uuid references public.usuarios(id);
alter table public.liquidacion_periodo add column if not exists anulado_motivo text;

-- 2) Contenido del período (para mostrar antes de borrar/anular).
create or replace function public.contenido_periodo_liquidacion(p_periodo_id uuid)
returns jsonb language plpgsql security definer set search_path=public, pg_catalog as $fn$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede consultar el período';
  end if;
  select jsonb_build_object(
    'padron',        (select count(*) from public.liquidacion_periodo_empleado where periodo_id = p_periodo_id),
    'conceptos',     (select count(*) from public.liquidacion_concepto_periodo where periodo_id = p_periodo_id),
    'dias',          (select count(*) from public.liquidacion_dias           where periodo_id = p_periodo_id),
    'ajustes',       (select count(*) from public.liquidacion_ajuste         where periodo_id = p_periodo_id),
    'importaciones', (select count(*) from public.liquidacion_importacion    where periodo_id = p_periodo_id),
    'consolidada',   (select count(*) from public.liquidacion_consolidada    where periodo_id = p_periodo_id),
    'enviado',       (select count(*) from public.liquidacion_enviado_visual where periodo_id = p_periodo_id),
    'resultado',     (select count(*) from public.liquidacion_resultado_visual where periodo_id = p_periodo_id)
  ) into v;
  -- historia = trabajo humano/hitos; padrón/conceptos/días son preparación regenerable.
  v := v || jsonb_build_object('tiene_historia',
    (v->>'ajustes')::int + (v->>'importaciones')::int + (v->>'consolidada')::int
    + (v->>'enviado')::int + (v->>'resultado')::int > 0);
  return v;
end $fn$;
revoke all on function public.contenido_periodo_liquidacion(uuid) from public, anon;
grant execute on function public.contenido_periodo_liquidacion(uuid) to authenticated;

-- 3) Eliminar (si vacío) o anular (si tiene historia, con p_forzar=true).
create or replace function public.eliminar_periodo_liquidacion(p_periodo_id uuid, p_forzar boolean default false, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path=public, pg_catalog as $fn$
declare
  v_uid uuid := auth.uid(); v_actor uuid; v_cont jsonb; v_historia boolean;
begin
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede eliminar/anular el período';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  if not exists (select 1 from public.liquidacion_periodo where id = p_periodo_id) then
    raise exception 'El período no existe';
  end if;
  v_cont := public.contenido_periodo_liquidacion(p_periodo_id);
  v_historia := (v_cont->>'tiene_historia')::boolean;

  if not v_historia then
    -- Sin historia: borrado físico. Se limpian hijos de preparación explícitamente.
    delete from public.liquidacion_dias           where periodo_id = p_periodo_id;
    delete from public.liquidacion_concepto_periodo where periodo_id = p_periodo_id;
    delete from public.liquidacion_periodo_empleado where periodo_id = p_periodo_id;
    delete from public.liquidacion_periodo where id = p_periodo_id;
    return jsonb_build_object('accion','eliminado','contenido',v_cont);
  end if;

  -- Con historia: nunca se borra. Se exige confirmación fuerte (p_forzar) y se anula.
  if not p_forzar then
    raise exception 'El período tiene datos (%). Confirmá para anularlo (no se borra la historia).', v_cont::text;
  end if;
  update public.liquidacion_periodo
    set estado='anulado', anulado_at=now(), anulado_por=v_actor,
        anulado_motivo=coalesce(p_motivo, anulado_motivo), updated_at=now()
    where id = p_periodo_id;
  return jsonb_build_object('accion','anulado','contenido',v_cont);
end $fn$;
revoke all on function public.eliminar_periodo_liquidacion(uuid,boolean,text) from public, anon;
grant execute on function public.eliminar_periodo_liquidacion(uuid,boolean,text) to authenticated;
