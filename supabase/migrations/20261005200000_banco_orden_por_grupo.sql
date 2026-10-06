-- 20261005200000_banco_orden_por_grupo
-- Archivo del banco (Galicia): ordenar las filas por GRUPO respetando el orden de
-- los módulos del Excel de trabajo — primero vigiladores (empleados), después
-- supervisores, por último administrativos — y alfabético dentro de cada grupo.
-- Antes ambas RPC ordenaban sólo por apellido, nombre. Sólo cambia el ORDER BY
-- (el formato/columnas/importes no se tocan).

-- Rango de grupo, espejo de grupoDeResumen (lib/resumen-guardia.ts): vigiladores=0,
-- supervisores=1, administrativos=2. Fallback por rol cuando el puesto es null.
create or replace function public.grupo_orden_banco(p_puesto text, p_rol text)
returns int language sql immutable as $$
  select case
    when lower(coalesce(p_puesto,'')) = 'vigilador' then 0
    when lower(coalesce(p_puesto,'')) in ('supervisor','jefe_supervisores') then 1
    when lower(coalesce(p_puesto,'')) in ('direccion_operativa','administracion','gerencia') then 2
    when lower(coalesce(p_rol,'')) = 'admin' then 2
    when lower(coalesce(p_rol,'')) = 'supervisor' then 1
    else 0
  end
$$;

create or replace function public.pagos_extras_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_mes text;
begin
  if auth.uid() is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede generar el archivo del banco';
  end if;
  select mes into v_mes from public.liquidacion_periodo where id = p_periodo_id;
  if v_mes is null then raise exception 'Período inexistente'; end if;

  return query
  select u.cuenta_bancaria, u.apellido||', '||coalesce(u.nombre,''), round(ev.v, 2)
  from public.usuarios u
  cross join lateral (select public.extra_mensual_vigente(u.id, v_mes) as v) ev
  where u.estado = 'activo' and nullif(btrim(u.cuenta_bancaria),'') is not null
    and ev.v is not null and ev.v > 0
  order by public.grupo_orden_banco(u.puesto_organizacional, u.rol), u.apellido, u.nombre;
end;
$function$;

create or replace function public.pagos_sueldos_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_mes text;
begin
  if auth.uid() is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede generar el archivo del banco';
  end if;
  select mes into v_mes from public.liquidacion_periodo where id = p_periodo_id;
  if v_mes is null then raise exception 'Período inexistente'; end if;

  return query
  with visual as (
    select u.apellido, coalesce(u.nombre,'') nom, u.cuenta_bancaria cta, round(f.neto,2) imp,
           u.puesto_organizacional pst, u.rol rl
    from public.liquidacion_resultado_visual rv
    join public.liquidacion_resultado_fila f on f.resultado_id = rv.id
    join public.liquidacion_persona p on p.cuil = f.cuil
    join public.usuarios u on u.id = p.usuario_id
    where rv.periodo_id = p_periodo_id and rv.vigente
      and f.cuil is not null and nullif(btrim(u.cuenta_bancaria),'') is not null
  ),
  excluidos as (
    select u.apellido, coalesce(u.nombre,'') nom, u.cuenta_bancaria cta,
           round(public.sueldo_mensual_vigente(u.id, v_mes), 2) imp,
           u.puesto_organizacional pst, u.rol rl
    from public.usuarios u
    where u.estado = 'activo' and nullif(btrim(u.cuenta_bancaria),'') is not null
      and public.sueldo_mensual_vigente(u.id, v_mes) is not null
      and u.id not in (
        select p.usuario_id
        from public.liquidacion_resultado_visual rv
        join public.liquidacion_resultado_fila f on f.resultado_id = rv.id
        join public.liquidacion_persona p on p.cuil = f.cuil
        where rv.periodo_id = p_periodo_id and rv.vigente and p.usuario_id is not null
      )
  )
  select t.cta, t.apellido||', '||t.nom, t.imp
  from (select * from visual union all select * from excluidos) t
  where t.imp is not null and t.imp <> 0
  order by public.grupo_orden_banco(t.pst, t.rl), t.apellido, t.nom;
end;
$function$;
