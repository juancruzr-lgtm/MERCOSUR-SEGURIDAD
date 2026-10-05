-- ============================================================================
-- Afiliación de Sindicato por marca del Excel de trabajo → concepto permanente 104
-- ============================================================================
--
-- JC (05/10): al reimportar el Excel de trabajo, la MARCA específica de Sindicato
-- de un empleado debe dar de ALTA automáticamente el concepto permanente 104
-- (Sindicato), con vigencia desde el período liquidado, aplicándose en esa misma
-- liquidación y continuando los meses siguientes. SIN duplicar: si ya tiene uno
-- activo/vigente, no crea otro. Si estaba dado de baja y se re-marca, nueva
-- afiliación CONSERVANDO el histórico anterior. La baja se hace por el botón de
-- la UI (no por desmarcar). No toca embargo.
--
-- Reconciliación robusta: por usuario_id (no por texto). Idempotente (reimportar
-- de nuevo no duplica). Gateada por puede_liquidar_actual() (Administración/Gerencia).
--
-- ROLLBACK: supabase/rollback/20261005140000_afiliar_sindicato_permanente_rollback.sql
-- ============================================================================

begin;

create or replace function public.afiliar_sindicato_permanente(p_usuarios uuid[], p_mes text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor      uuid;
  v_concepto   uuid;
  v_desde      date;
  v_fin_mes    date;
  v_uid        uuid;
  v_creados    integer := 0;
  v_ya_vigente integer := 0;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = auth.uid() and estado = 'activo';
  if not found then
    raise exception 'Usuario no activo';
  end if;
  if not public.puede_liquidar_actual() then
    raise exception 'No autorizado: requiere acceso a Liquidación';
  end if;
  if p_mes !~ '^\d{4}-\d{2}$' then
    raise exception 'Mes invalido (esperado YYYY-MM)';
  end if;
  v_desde   := (p_mes || '-01')::date;
  v_fin_mes := (date_trunc('month', v_desde) + interval '1 month - 1 day')::date;

  -- Concepto Sindicato (código visual 104, descuento). Un único activo.
  select id into v_concepto
  from public.liquidacion_concepto_catalogo
  where codigo_visual = '104' and activo
  order by created_at
  limit 1;
  if v_concepto is null then
    raise exception 'No existe el concepto 104 (Sindicato) activo en el catalogo';
  end if;

  foreach v_uid in array coalesce(p_usuarios, array[]::uuid[]) loop
    if v_uid is null then continue; end if;

    -- ¿Ya tiene un permanente 104 ACTIVO y vigente en el período? -> no duplicar.
    if exists (
      select 1 from public.liquidacion_concepto_permanente cp
      where cp.empleado_id = v_uid
        and cp.concepto_id = v_concepto
        and cp.activo = true
        and cp.vigencia_desde <= v_fin_mes
        and (cp.vigencia_hasta is null or cp.vigencia_hasta >= v_desde)
    ) then
      v_ya_vigente := v_ya_vigente + 1;
      continue;
    end if;

    -- Alta (nueva afiliación). Si había una baja previa, queda como histórico
    -- (no se toca): esta fila nueva arranca en el período liquidado.
    insert into public.liquidacion_concepto_permanente
      (empleado_id, concepto_id, importe, cantidad, vigencia_desde, vigencia_hasta, motivo, activo, created_by)
    values
      (v_uid, v_concepto, null, null, v_desde, null,
       'Afiliacion sindicato (marca Excel de trabajo ' || p_mes || ')', true, v_actor);
    v_creados := v_creados + 1;
  end loop;

  return jsonb_build_object('creados', v_creados, 'ya_vigentes', v_ya_vigente, 'mes', p_mes);
end;
$function$;

revoke all on function public.afiliar_sindicato_permanente(uuid[], text) from public, anon;
grant execute on function public.afiliar_sindicato_permanente(uuid[], text) to authenticated;

commit;

notify pgrst, 'reload schema';
