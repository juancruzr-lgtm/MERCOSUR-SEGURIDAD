-- 20261006140000_bajas_y_sueldos_excluir_inactivos
-- 1) pagos_sueldos_banco: excluir INACTIVOS también de la parte 'visual' (netos del
--    resultado de Visual importado). Antes sólo 'excluidos' filtraba estado='activo',
--    así que un empleado dado de baja con neto en el resultado seguía apareciendo en
--    el archivo del banco. (JC 06/10)
-- 2) Baja (estado inactivo) de empleados que figuran de baja y no deben ir en sueldos:
--    MENA BRIAN, OTERO RUBÉN, PIÑERO WALTER, VAZQUEZ VICTOR (bajas confirmadas por la
--    Consulta de Relaciones Laborales de AFIP) + GOMEZ JOSE MARIA y PEREZ SANTIAGO
--    (indicados por JC). Las liquidaciones finales se manejan aparte.

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

update public.usuarios set estado = 'inactivo'
 where estado = 'activo' and cuil in (
   '23400389829', -- MENA BRIAN (baja 30/09)
   '20354572738', -- OTERO RUBÉN (baja 17/09)
   '20304070170', -- PIÑERO WALTER (baja 30/09)
   '20416335061', -- VAZQUEZ VICTOR (baja 03/08)
   '20331285359', -- GOMEZ JOSE MARIA (indicado por JC)
   '20477655239'  -- PEREZ SANTIAGO (indicado por JC)
 );
