-- Rollback de 20261008100000_extras_del_mes_y_pagos_registrados
-- Vuelve a las funciones de 20261007130000 (extras = sólo extra fija) y quita el
-- registro de pagos. ATENCIÓN: borra los pagos registrados; exportarlos antes:
--   select * from public.liquidacion_pago_lote; select * from public.liquidacion_pago_registrado;

begin;
drop function if exists public.registrar_pago_banco(uuid,text,text,text,jsonb);
drop function if exists public.anular_pago_banco(uuid,text);
drop table if exists public.liquidacion_pago_registrado;
drop table if exists public.liquidacion_pago_lote;
drop function if exists public.pagos_sueldos_banco(uuid);
drop function if exists public.pagos_extras_banco(uuid);
drop function if exists public.pagos_banco_por_usuario(uuid);
drop function if exists public.pagos_banco_destinatarios();
-- Detalle por persona: sueldo y extras que se pagan por banco en el período.
--   sueldo = SUELDO MENSUAL vigente si lo tiene (fijo, sin importar Visual);
--            si no, neto de recibo del resultado de Visual vigente;
--            null si todavía no hay resultado de Visual (pendiente).
--   sueldo se informa YA NETO de adelantos (adelantos = lo descontado).
--   extras = extra fija vigente del mes (> 0).
create or replace function public.pagos_banco_por_usuario(p_periodo_id uuid)
 returns table(usuario_id uuid, cuenta text, nombre text, sueldo numeric, extras numeric, adelantos numeric, sueldo_fijo boolean, orden int)
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
    select p.usuario_id uid, max(round(f.neto, 2)) neto
    from public.liquidacion_resultado_visual rv
    join public.liquidacion_resultado_fila f on f.resultado_id = rv.id
    join public.liquidacion_persona p on p.cuil = f.cuil
    where rv.periodo_id = p_periodo_id and rv.vigente and f.cuil is not null and p.usuario_id is not null
    group by p.usuario_id
  ),
  adel as (
    select a.empleado_id uid, round(sum(a.valor_liquidacion), 2) adel
    from public.liquidacion_ajuste a
    where a.periodo_id = p_periodo_id and a.clave = 'adelantos' and a.valor_liquidacion is not null
    group by a.empleado_id
  ),
  base as (
    select u.id, u.cuenta_bancaria cta, u.apellido, coalesce(u.nombre, '') nom,
           round(public.sueldo_mensual_vigente(u.id, v_mes), 2) sm,
           round(public.extra_mensual_vigente(u.id, v_mes), 2) ex,
           public.grupo_orden_banco(u.puesto_organizacional, u.rol) ord
    from public.usuarios u
    where u.estado = 'activo' and not coalesce(u.excluir_pago_banco, false)
      and nullif(btrim(u.cuenta_bancaria), '') is not null
  )
  select b.id, b.cta, b.apellido || ', ' || b.nom,
         case when coalesce(b.sm, v.neto) is null then null
              else greatest(coalesce(b.sm, v.neto) - coalesce(a.adel, 0), 0) end,
         case when b.ex is not null and b.ex > 0 then b.ex else null end,
         nullif(coalesce(a.adel, 0), 0),
         b.sm is not null,
         b.ord
  from base b left join visual v on v.uid = b.id left join adel a on a.uid = b.id
  where b.sm is not null or v.neto is not null or (b.ex is not null and b.ex > 0)
  order by b.ord, b.apellido, b.nom;
end;
$function$;
revoke all on function public.pagos_banco_por_usuario(uuid) from public, anon;
grant execute on function public.pagos_banco_por_usuario(uuid) to authenticated;

-- Archivo de SUELDOS: sale del detalle (sueldo fijo o neto de Visual).
create or replace function public.pagos_sueldos_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  return query
  select d.cuenta, d.nombre, d.sueldo
  from public.pagos_banco_por_usuario(p_periodo_id) d
  where d.sueldo is not null and d.sueldo <> 0
  order by d.orden, d.nombre;
end;
$function$;

-- Archivo de EXTRAS: sale del mismo detalle.
create or replace function public.pagos_extras_banco(p_periodo_id uuid)
 returns table(cuenta text, nombre text, importe numeric)
 language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  return query
  select d.cuenta, d.nombre, d.extras
  from public.pagos_banco_por_usuario(p_periodo_id) d
  where d.extras is not null and d.extras > 0
  order by d.orden, d.nombre;
end;
$function$;

commit;
