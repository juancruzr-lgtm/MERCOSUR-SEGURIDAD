-- ============================================================================
-- LIQ · UNICIDAD POR PERÍODO ACTIVO — un anulado no bloquea recrear el mes
-- ============================================================================
-- Bug (JC 10/09): eliminar un período con historia lo deja 'anulado' (correcto,
-- preserva evidencia), pero `UNIQUE (mes)` + el chequeo de la RPC impedían crear
-- un NUEVO período activo del mismo mes ("Ya existe un período para 2026-08").
--
-- Regla de negocio DEFINITIVA: como máximo UN período ACTIVO por mes. Un período
-- 'anulado' queda consultable ("Ver anulados") pero NO bloquea la creación de uno
-- nuevo. La unicidad aplica al período ACTIVO, no a todo el histórico del mes.
--
-- Cambios (aditivos/reversibles, NO tocan datos ni cálculos):
--   1) Reemplaza UNIQUE(mes) por un índice único PARCIAL: unico por mes SÓLO
--      entre estados <> 'anulado' (pueden coexistir varios anulados del mismo mes).
--   2) `crear_periodo_liquidacion`: el chequeo de existencia excluye 'anulado'.
--      (Idéntica al original salvo esa línea.)
--
-- NO reutiliza un período anulado; siempre inserta uno nuevo. NO borra historia.
-- NO toca otros meses. NO modifica cálculos.
--
-- ROLLBACK:     supabase/rollback/20260910140000_liq_unicidad_periodo_activo_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260910140000_liq_unicidad_periodo_activo_pre_post.sql
-- ============================================================================

begin;

-- 1) Unicidad sólo sobre el período ACTIVO del mes.
alter table public.liquidacion_periodo drop constraint if exists liquidacion_periodo_mes_key;
create unique index if not exists uq_liquidacion_periodo_mes_activo
  on public.liquidacion_periodo (mes)
  where estado <> 'anulado';

-- 2) RPC: el chequeo de existencia ignora los anulados (resto idéntico al original).
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
  -- Sólo gerencia (o service_role). El service_role (auth.uid null) queda para automatización.
  if v_uid is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede crear un período de liquidación';
  end if;
  -- Unicidad sólo del período ACTIVO: un anulado no bloquea.
  if exists (select 1 from public.liquidacion_periodo where mes = p_mes and estado <> 'anulado') then
    raise exception 'Ya existe un período para %', p_mes;
  end if;

  insert into public.liquidacion_periodo(mes, estado, creado_por)
    values (p_mes, 'borrador', v_actor) returning id into v_periodo;

  -- Padrón: empleados activos productivos (no es_prueba). Snapshot de identidad.
  insert into public.liquidacion_periodo_empleado(periodo_id, empleado_id, cuil_snap, legajo_snap, nombre_snap)
  select v_periodo, u.id, u.cuil, coalesce(u.legajo_visual, u.legajo),
         coalesce(u.apellido,'')||', '||coalesce(u.nombre,'')
  from public.usuarios u
  where u.estado='activo' and coalesce(u.es_prueba,false)=false;

  -- Conceptos: DESDE CERO. Sólo entran los PERMANENTES vigentes en el mes
  -- (naturaleza: embargo/alimentos con vigencia). El resto se carga aparte.
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
