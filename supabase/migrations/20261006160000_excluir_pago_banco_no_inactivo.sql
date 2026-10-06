-- 20261006160000_excluir_pago_banco_no_inactivo
-- JC 06/10: los empleados dados de baja deben SEGUIR figurando en el listado (Excel
-- de trabajo) con sus horas y días (para su liquidación final), pero NO deben entrar
-- en los archivos de PAGO del banco (sueldos ni extras). Marcarlos 'inactivo' los
-- sacaba de todo (del Excel/Visual también). Se corrige con una marca dedicada:
--   usuarios.excluir_pago_banco = true  →  fuera de los archivos del banco, pero
--   siguen activos (figuran en el Excel de trabajo / Visual con horas y días).
-- Reemplaza el enfoque de #265 (que los puso inactivos): se vuelven a ACTIVO y se
-- marcan. El filtro estado='activo' de las RPC se mantiene para bajas reales.

alter table public.usuarios
  add column if not exists excluir_pago_banco boolean not null default false;

-- Reactivar y marcar a los 7 (los 6 de #265 + Cabrera de #266).
update public.usuarios
   set estado = 'activo', excluir_pago_banco = true
 where cuil in ('23400389829','20354572738','20304070170','20416335061','20331285359','20477655239')
    or id = '5752531b-3eaf-464b-85fb-49acd7a9ad5e';

-- pagos_sueldos_banco: excluir también a los marcados (en ambas CTEs).
create or replace function public.pagos_sueldos_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
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
      and u.estado = 'activo' and not coalesce(u.excluir_pago_banco, false)
      and f.cuil is not null and nullif(btrim(u.cuenta_bancaria),'') is not null
  ),
  excluidos as (
    select u.apellido, coalesce(u.nombre,'') nom, u.cuenta_bancaria cta,
           round(public.sueldo_mensual_vigente(u.id, v_mes), 2) imp,
           u.puesto_organizacional pst, u.rol rl
    from public.usuarios u
    where u.estado = 'activo' and not coalesce(u.excluir_pago_banco, false)
      and nullif(btrim(u.cuenta_bancaria),'') is not null
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

-- pagos_extras_banco: excluir también a los marcados.
create or replace function public.pagos_extras_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
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
  where u.estado = 'activo' and not coalesce(u.excluir_pago_banco, false)
    and nullif(btrim(u.cuenta_bancaria),'') is not null
    and ev.v is not null and ev.v > 0
  order by public.grupo_orden_banco(u.puesto_organizacional, u.rol), u.apellido, u.nombre;
end;
$function$;
