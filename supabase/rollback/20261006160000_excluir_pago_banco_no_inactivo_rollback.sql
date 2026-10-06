-- Rollback de 20261006160000_excluir_pago_banco_no_inactivo
-- Vuelve al estado previo (#265/#266): los 7 inactivos, RPCs sin la marca, sin columna.

update public.usuarios set estado = 'inactivo'
 where cuil in ('23400389829','20354572738','20304070170','20416335061','20331285359','20477655239')
    or id = '5752531b-3eaf-464b-85fb-49acd7a9ad5e';

alter table public.usuarios drop column if exists excluir_pago_banco;

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
      and u.estado = 'activo'
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
  where u.estado = 'activo' and nullif(btrim(u.cuenta_bancaria),'') is not null
    and ev.v is not null and ev.v > 0
  order by public.grupo_orden_banco(u.puesto_organizacional, u.rol), u.apellido, u.nombre;
end;
$function$;
