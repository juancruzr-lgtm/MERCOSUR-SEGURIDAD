-- ============================================================================
-- LIQ1C — Comparación contra el período anterior (control de omisiones)
-- ============================================================================
-- El período nace limpio (no copia el anterior). Esta función compara un período
-- con el INMEDIATAMENTE ANTERIOR (por mes) y marca anomalías por (empleado,
-- concepto): 'desaparecido' (estaba antes y ahora no => posible omisión),
-- 'nuevo' (aparece ahora y no estaba), 'cambio' (mismo concepto, importe distinto).
-- Es SÓLO control: NO copia ni modifica nada. Gerencia-only.
--
-- ROLLBACK: supabase/rollback/20260908180000_liq1c_comparacion_rollback.sql
-- ============================================================================
create or replace function public.comparar_liquidacion_anterior(p_periodo_id uuid)
returns table (
  empleado_id uuid, concepto_id uuid, codigo text, concepto text,
  estado text, importe_actual numeric, importe_anterior numeric
) language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare
  v_mes text; v_mes_ant text; v_per_ant uuid;
begin
  if auth.uid() is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede comparar liquidaciones';
  end if;
  select mes into v_mes from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  -- Período inmediatamente anterior (mayor mes < actual).
  select id, mes into v_per_ant, v_mes_ant from public.liquidacion_periodo
    where mes < v_mes order by mes desc limit 1;

  return query
  with actual as (
    select cp.empleado_id, cp.concepto_id, cp.importe from public.liquidacion_concepto_periodo cp where cp.periodo_id = p_periodo_id
  ),
  anterior as (
    select cp.empleado_id, cp.concepto_id, cp.importe from public.liquidacion_concepto_periodo cp where v_per_ant is not null and cp.periodo_id = v_per_ant
  ),
  comp as (
    select coalesce(a.empleado_id, b.empleado_id) as empleado_id,
           coalesce(a.concepto_id, b.concepto_id) as concepto_id,
           a.importe as imp_act, b.importe as imp_ant,
           case when b.empleado_id is null then 'nuevo'
                when a.empleado_id is null then 'desaparecido'
                when coalesce(a.importe,0) <> coalesce(b.importe,0) then 'cambio'
                else 'igual' end as est
    from actual a full outer join anterior b
      on a.empleado_id = b.empleado_id and a.concepto_id = b.concepto_id
  )
  select c.empleado_id, c.concepto_id, cat.codigo_visual, cat.nombre, c.est, c.imp_act, c.imp_ant
  from comp c left join public.liquidacion_concepto_catalogo cat on cat.id = c.concepto_id
  where c.est <> 'igual'
  order by c.est, cat.codigo_visual;
end;
$fn$;
revoke all on function public.comparar_liquidacion_anterior(uuid) from public, anon;
grant execute on function public.comparar_liquidacion_anterior(uuid) to authenticated;
