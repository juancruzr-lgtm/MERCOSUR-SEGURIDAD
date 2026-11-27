-- Adelantos en cuotas automáticos (JC 27/11/2026).
--
-- Un "plan de adelanto" se carga como concepto permanente por empleado (importe =
-- cuota mensual, vigencia = los meses de las cuotas) sobre un concepto marcado
-- `es_adelanto`. Al CREAR cada período, su cuota vigente se siembra como ajuste
-- 'adelantos' (columna AR del Excel de trabajo). De ahí en adelante NO se toca
-- nada del cálculo: el Excel completo / libro general restan el adelanto del
-- SUELDO DEL MES y las RPC del banco (pagos_* ) depositan el sueldo ya neto,
-- porque todos leen `liquidacion_ajuste` con clave='adelantos'.
--
-- El sembrado es idempotente y respeta la carga manual: ON CONFLICT (período,
-- empleado, 'adelantos') DO NOTHING, así un adelanto escrito a mano en AR nunca
-- se pisa. El reimport del Excel sigue actualizando esa misma fila por diferencia.
--
-- Los conceptos `es_adelanto` se EXCLUYEN del canal de conceptos del período
-- (liquidacion_concepto_periodo → Visual): el adelanto vive sólo en el ajuste,
-- no se duplica ni intenta ir a Visual.

-- 1) Marca de concepto de adelanto en el catálogo.
alter table public.liquidacion_concepto_catalogo
  add column if not exists es_adelanto boolean not null default false;

comment on column public.liquidacion_concepto_catalogo.es_adelanto is
  'true = concepto de ADELANTO en cuotas. Su permanente por empleado se siembra como ajuste "adelantos" del período (columna AR; se descuenta del sueldo en Excel/libro/banco). No va a Visual.';

-- 2) El concepto "Adelanto de sueldo" ya creado queda marcado.
update public.liquidacion_concepto_catalogo
  set es_adelanto = true
  where nombre = 'Adelanto de sueldo' and categoria = 'descuento' and codigo_visual is null;

-- 3) crear_periodo_liquidacion: igual que antes + siembra de adelantos y
--    exclusión de los conceptos de adelanto del canal de Visual.
create or replace function public.crear_periodo_liquidacion(p_mes text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
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
  if exists (select 1 from public.liquidacion_periodo where mes = p_mes and estado <> 'anulado') then
    raise exception 'Ya existe un período para %', p_mes;
  end if;

  insert into public.liquidacion_periodo(mes, estado, creado_por)
    values (p_mes, 'borrador', v_actor) returning id into v_periodo;

  insert into public.liquidacion_periodo_empleado(periodo_id, empleado_id, cuil_snap, legajo_snap, nombre_snap)
  select v_periodo, u.id, u.cuil, coalesce(u.legajo_visual, u.legajo),
         coalesce(u.apellido,'')||', '||coalesce(u.nombre,'')
  from public.usuarios u
  where u.estado='activo' and coalesce(u.es_prueba,false)=false;

  -- Conceptos permanentes vigentes → conceptos del período (canal de Visual).
  -- Se EXCLUYEN los conceptos de adelanto: esos van por el ajuste 'adelantos'.
  insert into public.liquidacion_concepto_periodo(periodo_id, empleado_id, concepto_id, cantidad, importe, origen, origen_detalle, created_by)
  select v_periodo, cp.empleado_id, cp.concepto_id, cp.cantidad, cp.importe, 'permanente_individual',
         'auto: permanente vigente', v_actor
  from public.liquidacion_concepto_permanente cp
  join public.liquidacion_concepto_catalogo c on c.id = cp.concepto_id
  where cp.activo = true
    and coalesce(c.es_adelanto, false) = false
    and cp.vigencia_desde <= v_hasta
    and (cp.vigencia_hasta is null or cp.vigencia_hasta >= v_desde)
    and exists (select 1 from public.liquidacion_periodo_empleado pe where pe.periodo_id=v_periodo and pe.empleado_id=cp.empleado_id);

  -- Adelantos en cuotas: la cuota vigente del mes se siembra como ajuste
  -- 'adelantos' (columna AR). Suma por si hubiera más de un plan por empleado.
  -- ON CONFLICT DO NOTHING: no pisa un adelanto cargado a mano.
  insert into public.liquidacion_ajuste(periodo_id, empleado_id, tipo, clave, etiqueta, valor_liquidacion, origen, motivo, created_by)
  select v_periodo, cp.empleado_id, 'variable', 'adelantos', 'Adelantos',
         sum(cp.importe), 'plan_adelanto', 'auto: plan de adelanto en cuotas (permanente vigente)', v_actor
  from public.liquidacion_concepto_permanente cp
  join public.liquidacion_concepto_catalogo c on c.id = cp.concepto_id
  where cp.activo = true
    and coalesce(c.es_adelanto, false) = true
    and cp.importe is not null
    and cp.vigencia_desde <= v_hasta
    and (cp.vigencia_hasta is null or cp.vigencia_hasta >= v_desde)
    and exists (select 1 from public.liquidacion_periodo_empleado pe where pe.periodo_id=v_periodo and pe.empleado_id=cp.empleado_id)
  group by cp.empleado_id
  on conflict (periodo_id, empleado_id, clave) do nothing;

  return v_periodo;
end;
$function$;
