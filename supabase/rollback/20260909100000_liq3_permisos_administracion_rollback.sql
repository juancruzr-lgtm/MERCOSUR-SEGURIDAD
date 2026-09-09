begin;
drop policy if exists liquidacion_ajuste_liquidacion on public.liquidacion_ajuste;
create policy liquidacion_ajuste_gerencia on public.liquidacion_ajuste for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_auditoria_liquidacion on public.liquidacion_auditoria;
create policy liquidacion_auditoria_gerencia on public.liquidacion_auditoria for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_concepto_catalogo_liquidacion on public.liquidacion_concepto_catalogo;
create policy liquidacion_concepto_catalogo_gerencia on public.liquidacion_concepto_catalogo for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_concepto_periodo_liquidacion on public.liquidacion_concepto_periodo;
create policy liquidacion_concepto_periodo_gerencia on public.liquidacion_concepto_periodo for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_concepto_permanente_liquidacion on public.liquidacion_concepto_permanente;
create policy liquidacion_concepto_permanente_gerencia on public.liquidacion_concepto_permanente for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_consolidada_liquidacion on public.liquidacion_consolidada;
create policy liquidacion_consolidada_gerencia on public.liquidacion_consolidada for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_dias_liquidacion on public.liquidacion_dias;
create policy liquidacion_dias_gerencia on public.liquidacion_dias for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_expediente_liquidacion on public.liquidacion_expediente;
create policy liquidacion_expediente_gerencia on public.liquidacion_expediente for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_importacion_liquidacion on public.liquidacion_importacion;
create policy liquidacion_importacion_gerencia on public.liquidacion_importacion for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_periodo_liquidacion on public.liquidacion_periodo;
create policy liquidacion_periodo_gerencia on public.liquidacion_periodo for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_periodo_empleado_liquidacion on public.liquidacion_periodo_empleado;
create policy liquidacion_periodo_empleado_gerencia on public.liquidacion_periodo_empleado for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
drop policy if exists liquidacion_persona_liquidacion on public.liquidacion_persona;
create policy liquidacion_persona_gerencia on public.liquidacion_persona for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
CREATE OR REPLACE FUNCTION public.aplicar_ajustes_liquidacion(p_periodo_id uuid, p_archivo text, p_hash text, p_motivo text, p_ajustes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_lote uuid;
  v_estado text;
  aj jsonb;
  v_emp uuid;
  v_ant numeric;
  v_total int := 0; v_altas int := 0; v_cambios int := 0; v_errores int := 0;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede aplicar ajustes de liquidación';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado in ('cerrado','exportado') then raise exception 'El período está % : no admite ajustes', v_estado; end if;
  if p_hash is null or length(p_hash) < 8 then raise exception 'Hash de archivo requerido (anti-duplicado)'; end if;
  if exists (select 1 from public.liquidacion_importacion where periodo_id=p_periodo_id and hash=p_hash) then
    raise exception 'Este archivo ya fue reimportado en este período (dedupe por hash)';
  end if;

  insert into public.liquidacion_importacion(periodo_id, archivo, hash, usuario_id)
    values (p_periodo_id, p_archivo, p_hash, v_actor) returning id into v_lote;

  for aj in select * from jsonb_array_elements(p_ajustes) loop
    v_total := v_total + 1;
    v_emp := nullif(aj->>'empleado_id','')::uuid;
    if v_emp is null or nullif(aj->>'clave','') is null then v_errores := v_errores + 1; continue; end if;

    select valor_liquidacion into v_ant from public.liquidacion_ajuste
      where periodo_id=p_periodo_id and empleado_id=v_emp and clave=(aj->>'clave');

    insert into public.liquidacion_ajuste(periodo_id, empleado_id, tipo, clave, etiqueta, concepto_id,
                                          valor_operativo, valor_liquidacion, origen, motivo, lote_id, created_by)
      values (p_periodo_id, v_emp, coalesce(nullif(aj->>'tipo',''),'variable'), aj->>'clave', nullif(aj->>'etiqueta',''),
              nullif(aj->>'concepto_id','')::uuid,
              nullif(aj->>'valor_operativo','')::numeric, nullif(aj->>'valor_liquidacion','')::numeric,
              'excel_reimport', coalesce(nullif(aj->>'motivo',''), p_motivo), v_lote, v_actor)
      on conflict (periodo_id, empleado_id, clave) do update
        set valor_operativo = excluded.valor_operativo,
            valor_liquidacion = excluded.valor_liquidacion,
            etiqueta = excluded.etiqueta,
            motivo = excluded.motivo,
            lote_id = excluded.lote_id,
            created_by = excluded.created_by,
            updated_at = now();

    if v_ant is null then v_altas := v_altas + 1; else v_cambios := v_cambios + 1; end if;

    insert into public.liquidacion_auditoria(periodo_id, empleado_id, concepto_id, codigo, importe_anterior, importe_nuevo, origen, lote_id, usuario_id, motivo)
      values (p_periodo_id, v_emp, nullif(aj->>'concepto_id','')::uuid, aj->>'clave',
              v_ant, nullif(aj->>'valor_liquidacion','')::numeric, 'ajuste_excel', v_lote, v_actor,
              coalesce(nullif(aj->>'motivo',''), p_motivo));
  end loop;

  update public.liquidacion_importacion set filas_total=v_total, filas_aplicadas=(v_altas+v_cambios), filas_error=v_errores where id=v_lote;
  return jsonb_build_object('lote', v_lote, 'total', v_total, 'altas', v_altas, 'cambios', v_cambios, 'errores', v_errores);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.comparar_liquidacion_anterior(p_periodo_id uuid)
 RETURNS TABLE(empleado_id uuid, concepto_id uuid, codigo text, concepto text, estado text, importe_actual numeric, importe_anterior numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.consolidar_periodo(p_periodo_id uuid, p_filas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_estado text;
  f jsonb;
  v_n int := 0;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede consolidar liquidaciones';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado in ('exportada','liquidada') then raise exception 'El período está % : no se puede re-consolidar', v_estado; end if;

  -- Re-consolidar reemplaza el snapshot anterior (nace de cero, coherente con
  -- "cada período nace limpio").
  delete from public.liquidacion_consolidada where periodo_id = p_periodo_id;

  for f in select * from jsonb_array_elements(p_filas) loop
    if nullif(f->>'empleado_id','') is null or nullif(f->>'codigo','') is null then continue; end if;
    insert into public.liquidacion_consolidada(periodo_id, empleado_id, legajo_visual, cuil, nombre, codigo, cantidad, importe)
      values (p_periodo_id, (f->>'empleado_id')::uuid, nullif(f->>'legajo_visual',''), nullif(f->>'cuil',''),
              nullif(f->>'nombre',''), f->>'codigo', coalesce(nullif(f->>'cantidad','')::numeric, 1), nullif(f->>'importe','')::numeric)
      on conflict (periodo_id, empleado_id, codigo) do update
        set cantidad = excluded.cantidad, importe = excluded.importe,
            legajo_visual = excluded.legajo_visual, cuil = excluded.cuil, nombre = excluded.nombre;
    v_n := v_n + 1;
  end loop;

  update public.liquidacion_periodo
     set estado='consolidada', consolidado_at=now(), consolidado_por=v_actor, updated_at=now()
   where id = p_periodo_id;

  return jsonb_build_object('filas', v_n, 'estado', 'consolidada');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.crear_periodo_liquidacion(p_mes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede crear un período de liquidación';
  end if;
  if exists (select 1 from public.liquidacion_periodo where mes = p_mes) then
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
$function$
;
CREATE OR REPLACE FUNCTION public.importar_conceptos_liquidacion(p_periodo_id uuid, p_archivo text, p_hash text, p_motivo text, p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_lote uuid;
  v_estado text;
  ln jsonb;
  v_concepto uuid;
  v_emp uuid;
  v_cant_ant numeric; v_imp_ant numeric;
  v_altas int := 0; v_cambios int := 0; v_errores int := 0; v_total int := 0;
  v_mes text; v_desde date; v_hasta date;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede importar conceptos de liquidación';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado, mes into v_estado, v_mes from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado in ('cerrado','exportado') then raise exception 'El período está % : no admite importación', v_estado; end if;
  if p_hash is null or length(p_hash) < 8 then raise exception 'Hash de archivo requerido (anti-duplicado)'; end if;
  if exists (select 1 from public.liquidacion_importacion where periodo_id=p_periodo_id and hash=p_hash) then
    raise exception 'Este archivo ya fue importado en este período (dedupe por hash)';
  end if;
  v_desde := (v_mes || '-01')::date;
  v_hasta := (date_trunc('month',(v_mes||'-01')::date) + interval '1 month - 1 day')::date;

  insert into public.liquidacion_importacion(periodo_id, archivo, hash, usuario_id)
    values (p_periodo_id, p_archivo, p_hash, v_actor) returning id into v_lote;

  for ln in select * from jsonb_array_elements(p_lineas) loop
    v_total := v_total + 1;
    v_emp := nullif(ln->>'empleado_id','')::uuid;
    if v_emp is null then v_errores := v_errores + 1; continue; end if;

    -- Concepto: usar el provisto, o buscar por código, o CREAR (desconocido clasificado).
    v_concepto := nullif(ln->>'concepto_id','')::uuid;
    if v_concepto is null then
      select id into v_concepto from public.liquidacion_concepto_catalogo where codigo_visual = (ln->>'codigo');
    end if;
    if v_concepto is null then
      insert into public.liquidacion_concepto_catalogo(codigo_visual, nombre, categoria, origen, created_by)
        values (nullif(ln->>'codigo',''), coalesce(nullif(ln->>'nombre',''),'(sin nombre)'),
                coalesce(nullif(ln->>'categoria',''),'base_auxiliar'),
                coalesce(nullif(ln->>'origen',''),'importado'), v_actor)
        returning id into v_concepto;
    end if;

    -- Valor anterior (para auditoría y detección de cambio).
    select cantidad, importe into v_cant_ant, v_imp_ant
      from public.liquidacion_concepto_periodo
      where periodo_id=p_periodo_id and empleado_id=v_emp and concepto_id=v_concepto
      limit 1;

    -- Upsert: un concepto por (período, empleado). Reemplaza si ya existía.
    delete from public.liquidacion_concepto_periodo
      where periodo_id=p_periodo_id and empleado_id=v_emp and concepto_id=v_concepto;
    insert into public.liquidacion_concepto_periodo(periodo_id, empleado_id, concepto_id, cantidad, importe, origen, origen_detalle, created_by)
      values (p_periodo_id, v_emp, v_concepto,
              nullif(ln->>'cantidad','')::numeric, nullif(ln->>'importe','')::numeric,
              'importado', 'lote:'||v_lote::text, v_actor);

    if v_cant_ant is null and v_imp_ant is null then v_altas := v_altas + 1; else v_cambios := v_cambios + 1; end if;

    insert into public.liquidacion_auditoria(periodo_id, empleado_id, concepto_id, codigo, cantidad_anterior, cantidad_nueva, importe_anterior, importe_nuevo, origen, lote_id, usuario_id, motivo)
      values (p_periodo_id, v_emp, v_concepto, ln->>'codigo', v_cant_ant, nullif(ln->>'cantidad','')::numeric, v_imp_ant, nullif(ln->>'importe','')::numeric, 'importado', v_lote, v_actor, p_motivo);

    -- Permanente individual (si el usuario lo marcó): vigencia desde/hasta.
    if coalesce((ln->>'permanente')::boolean, false) then
      insert into public.liquidacion_concepto_permanente(empleado_id, concepto_id, cantidad, importe, vigencia_desde, vigencia_hasta, motivo, created_by)
        values (v_emp, v_concepto, nullif(ln->>'cantidad','')::numeric, nullif(ln->>'importe','')::numeric,
                coalesce(nullif(ln->>'vigencia_desde','')::date, v_desde), nullif(ln->>'vigencia_hasta','')::date,
                coalesce(p_motivo,'importado como permanente'), v_actor);
    end if;
  end loop;

  update public.liquidacion_importacion set filas_total=v_total, filas_aplicadas=(v_altas+v_cambios), filas_error=v_errores where id=v_lote;
  return jsonb_build_object('lote', v_lote, 'total', v_total, 'altas', v_altas, 'cambios', v_cambios, 'errores', v_errores);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.marcar_exportada_visual(p_periodo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_estado text;
  v_filas int;
begin
  if v_uid is not null and not public.es_gerencia_actual() then
    raise exception 'Sólo Gerencia puede exportar a Visual';
  end if;
  select id into v_actor from public.usuarios where auth_user_id = v_uid and estado='activo';
  select estado into v_estado from public.liquidacion_periodo where id = p_periodo_id;
  if not found then raise exception 'Período inexistente'; end if;
  if v_estado <> 'consolidada' then raise exception 'El período debe estar consolidado para exportar (está %)', v_estado; end if;
  select count(*) into v_filas from public.liquidacion_consolidada where periodo_id = p_periodo_id;
  if v_filas = 0 then raise exception 'No hay filas consolidadas para exportar'; end if;

  update public.liquidacion_periodo
     set estado='exportada', exportada_at=now(), exportada_por=v_actor, updated_at=now()
   where id = p_periodo_id;
  return jsonb_build_object('estado','exportada','filas',v_filas);
end;
$function$
;
drop function if exists public.puede_liquidar_actual();
commit;