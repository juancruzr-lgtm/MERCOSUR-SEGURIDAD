-- ============================================================================
-- LIQ · PAGOS — archivos para el banco (Galicia): sueldos y extras
-- ============================================================================
-- (JC 11/09) Dos RPC que devuelven las filas del archivo de acreditación
-- (formato Galicia: Cuenta | Nombre | Importe), por período:
--   · pagos_sueldos_banco: NETO de Visual por persona (resultado vigente) PARA
--     los que pasan por Visual, MÁS el SUELDO MENSUAL de los de nómina con cuenta
--     que NO pasan por Visual (excluidos que cobran por banco). Todos con cuenta.
--   · pagos_extras_banco: EXTRA fija vigente del mes por persona con cuenta (>0).
--
-- Sólo LECTURA. Gated por puede_liquidar_actual() (Gerencia/Administración).
-- El importe de sueldos NO se recalcula: sale del resultado que Visual devolvió.
--
-- ROLLBACK:     supabase/rollback/20260911100000_pagos_banco_galicia_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260911100000_pagos_banco_galicia_pre_post.sql
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.puede_liquidar_actual()') is null then raise exception 'falta puede_liquidar_actual()'; end if;
  if to_regprocedure('public.sueldo_mensual_vigente(uuid,text)') is null then raise exception 'falta sueldo_mensual_vigente'; end if;
  if to_regprocedure('public.extra_mensual_vigente(uuid,text)') is null then raise exception 'falta extra_mensual_vigente'; end if;
end $$;

-- SUELDOS: neto de Visual (resultado vigente) + sueldo mensual de los excluidos con cuenta.
create or replace function public.pagos_sueldos_banco(p_periodo_id uuid)
returns table(cuenta text, nombre text, importe numeric)
language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
declare v_mes text;
begin
  if auth.uid() is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede generar el archivo del banco';
  end if;
  select mes into v_mes from public.liquidacion_periodo where id = p_periodo_id;
  if v_mes is null then raise exception 'Período inexistente'; end if;

  return query
  with visual as (
    select u.apellido, coalesce(u.nombre,'') nom, u.cuenta_bancaria cta, round(f.neto,2) imp
    from public.liquidacion_resultado_visual rv
    join public.liquidacion_resultado_fila f on f.resultado_id = rv.id
    join public.liquidacion_persona p on p.cuil = f.cuil
    join public.usuarios u on u.id = p.usuario_id
    where rv.periodo_id = p_periodo_id and rv.vigente
      and f.cuil is not null and nullif(btrim(u.cuenta_bancaria),'') is not null
  ),
  excluidos as (
    select u.apellido, coalesce(u.nombre,'') nom, u.cuenta_bancaria cta,
           round(public.sueldo_mensual_vigente(u.id, v_mes), 2) imp
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
  order by t.apellido, t.nom;
end;
$fn$;

-- EXTRAS: extra fija vigente del mes por persona con cuenta (>0).
create or replace function public.pagos_extras_banco(p_periodo_id uuid)
returns table(cuenta text, nombre text, importe numeric)
language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
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
  order by u.apellido, u.nombre;
end;
$fn$;

revoke all on function public.pagos_sueldos_banco(uuid) from public, anon;
revoke all on function public.pagos_extras_banco(uuid) from public, anon;
grant execute on function public.pagos_sueldos_banco(uuid) to authenticated;
grant execute on function public.pagos_extras_banco(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
