-- ============================================================================
-- ROLLBACK · LIQ UNICIDAD POR PERÍODO ACTIVO (20260910140000)
-- ============================================================================
-- Restaura UNIQUE(mes) total y el chequeo original de la RPC. OJO: si tras el fix
-- se crearon dos períodos del mismo mes (uno anulado + uno activo), restaurar
-- UNIQUE(mes) FALLARÁ por duplicado; en ese caso NO revertir sin antes resolver
-- (mantener sólo uno por mes). El rollback no borra datos.
-- ============================================================================

begin;

drop index if exists public.uq_liquidacion_periodo_mes_activo;
-- Reponer la unicidad total (puede fallar si hay >1 fila por mes; ver nota).
alter table public.liquidacion_periodo
  add constraint liquidacion_periodo_mes_key unique (mes);

-- RPC al chequeo original (cuenta TODOS los estados).
create or replace function public.crear_periodo_liquidacion(p_mes text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_uid uuid;
  v_actor uuid;
  v_periodo uuid;
  v_desde date := (p_mes || '-01')::date;
  v_hasta date := (date_trunc('month', (p_mes || '-01')::date) + interval '1 month - 1 day')::date;
begin
  if p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mes inválido (YYYY-MM)'; end if;
  v_uid := auth.uid();
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede crear un período de liquidación';
  end if;
  if exists (select 1 from public.liquidacion_periodo where mes = p_mes) then
    raise exception 'Ya existe un período para %', p_mes;
  end if;

  insert into public.liquidacion_periodo(mes, estado, creado_por)
    values (p_mes, 'borrador', v_actor) returning id into v_periodo;

  insert into public.liquidacion_periodo_empleado(periodo_id, empleado_id, cuil_snap, legajo_snap, nombre_snap)
  select v_periodo, u.id, u.cuil, coalesce(u.legajo_visual, u.legajo),
         coalesce(u.apellido,'')||', '||coalesce(u.nombre,'')
  from public.usuarios u
  where u.estado='activo' and coalesce(u.es_prueba,false)=false;

  insert into public.liquidacion_concepto_periodo(periodo_id, empleado_id, concepto_id, cantidad, importe, origen, origen_detalle, created_by)
  select v_periodo, cp.empleado_id, cp.concepto_id, cp.cantidad, cp.importe, 'permanente_individual',
         'auto: permanente vigente', v_actor
  from public.liquidacion_concepto_permanente cp
  where cp.activo = true
    and cp.vigencia_desde <= v_hasta
    and (cp.vigencia_hasta is null or cp.vigencia_hasta >= v_desde)
    and exists (select 1 from public.liquidacion_periodo_empleado pe where pe.periodo_id=v_periodo and pe.empleado_id=cp.empleado_id);

  return v_periodo;
end;
$fn$;
revoke all on function public.crear_periodo_liquidacion(text) from public, anon;
grant execute on function public.crear_periodo_liquidacion(text) to authenticated;

notify pgrst, 'reload schema';

commit;
