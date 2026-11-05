-- Rollback de 20261206100000_seguridad_montos_liquidacion_gate.
-- Restaura las cuatro funciones con su definición viva del 05/11/2026 (mismo
-- md5 de prosrc: dos tenían fin de línea CRLF) y borra liquidacion_montos_gate().
-- ATENCIÓN: vuelve a dejar los montos expuestos a cualquier usuario con sesión.
begin;

do $do$ begin execute replace($def$
CREATE OR REPLACE FUNCTION public.sueldo_mensual_vigente(p_usuario_id uuid, p_mes text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select sm.importe
  from public.liquidacion_sueldo_mensual sm
  where sm.usuario_id = p_usuario_id
    and sm.vigencia_desde <= (date_trunc('month',(p_mes||'-01')::date) + interval '1 month - 1 day')::date
    and (sm.vigencia_hasta is null or sm.vigencia_hasta >= (p_mes||'-01')::date)
  order by sm.vigencia_desde desc
  limit 1;
$function$
$def$, E'\r\n', E'\n'); end $do$;

do $do$ begin execute replace($def$
CREATE OR REPLACE FUNCTION public.extra_mensual_vigente(p_usuario_id uuid, p_mes text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select em.importe
  from public.liquidacion_extra_mensual em
  where em.usuario_id = p_usuario_id
    and em.vigencia_desde <= (date_trunc('month',(p_mes||'-01')::date) + interval '1 month - 1 day')::date
    and (em.vigencia_hasta is null or em.vigencia_hasta >= (p_mes||'-01')::date)
  order by em.vigencia_desde desc
  limit 1;
$function$
$def$, E'\r\n', E'\n'); end $do$;

-- Estas dos tenían el cuerpo con CRLF en producción: se reconstruye igual.
do $do$ begin execute
  'CREATE OR REPLACE FUNCTION public.liquidacion_final_extras_pagadas(p_empleado_id uuid, p_mes text)' || E'\n' ||
  ' RETURNS numeric' || E'\n' || ' LANGUAGE sql' || E'\n' || ' STABLE SECURITY DEFINER' || E'\n' ||
  ' SET search_path TO ''public'', ''pg_catalog''' || E'\n' || 'AS $function$' ||
  replace(replace($body$
  select round(coalesce(sum(r.importe), 0), 2)
    from public.liquidacion_pago_registrado r
    join public.liquidacion_pago_lote l on l.id = r.lote_id and l.anulado_at is null
    join public.liquidacion_periodo p on p.id = r.periodo_id
   where r.tipo = 'extras' and r.usuario_id = p_empleado_id and p.mes = p_mes
$body$, E'\r\n', E'\n'), E'\n', E'\r\n') || '$function$';
end $do$;

do $do$ begin execute
  'CREATE OR REPLACE FUNCTION public.liquidacion_final_ya_liquidado(p_cuil text, p_mes text)' || E'\n' ||
  ' RETURNS jsonb' || E'\n' || ' LANGUAGE sql' || E'\n' || ' STABLE SECURITY DEFINER' || E'\n' ||
  ' SET search_path TO ''public'', ''pg_catalog''' || E'\n' || 'AS $function$' ||
  replace(replace($body$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'cantidad', x.cantidad, 'importe', x.importe) order by x.codigo), '[]'::jsonb)
  from (select e.codigo, sum(coalesce(e.cantidad, 0)) as cantidad, round(sum(coalesce(e.importe, 0)), 2) as importe
          from public.liquidacion_enviado_visual e
          join public.liquidacion_periodo p on p.id = e.periodo_id
         where p.mes = p_mes and p.estado in ('exportada','liquidada')
           and regexp_replace(coalesce(e.cuil, ''), '\D', '', 'g') = p_cuil
         group by e.codigo) x
$body$, E'\r\n', E'\n'), E'\n', E'\r\n') || '$function$';
end $do$;

drop function if exists public.liquidacion_montos_gate();

-- ACL viva: {postgres=X, authenticated=X, service_role=X}
revoke all on function public.sueldo_mensual_vigente(uuid, text) from public, anon;
revoke all on function public.extra_mensual_vigente(uuid, text) from public, anon;
revoke all on function public.liquidacion_final_extras_pagadas(uuid, text) from public, anon;
revoke all on function public.liquidacion_final_ya_liquidado(text, text) from public, anon;
grant execute on function public.sueldo_mensual_vigente(uuid, text) to authenticated, service_role;
grant execute on function public.extra_mensual_vigente(uuid, text) to authenticated, service_role;
grant execute on function public.liquidacion_final_extras_pagadas(uuid, text) to authenticated, service_role;
grant execute on function public.liquidacion_final_ya_liquidado(text, text) to authenticated, service_role;

do $do$
declare
  v_esperado constant jsonb := jsonb_build_object(
    'sueldo_mensual_vigente(uuid,text)',           '5b58db0f469964991d5a446560b69419',
    'extra_mensual_vigente(uuid,text)',            '72b66f4b5f47d256188ffb29437c30a9',
    'liquidacion_final_extras_pagadas(uuid,text)', 'd2cefe6bda4f64d0a8853ae3fdc29d96',
    'liquidacion_final_ya_liquidado(text,text)',   '0a54da87cab88633096f9b02e8ffd9a0');
  v_firma text;
begin
  for v_firma in select jsonb_object_keys(v_esperado) loop
    if (select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.' || v_firma)) is distinct from v_esperado->>v_firma then
      raise exception 'rollback: % no quedó con el md5 vivo', v_firma;
    end if;
  end loop;
end $do$;

commit;
