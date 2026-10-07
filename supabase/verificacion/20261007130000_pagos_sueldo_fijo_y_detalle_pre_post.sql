-- VERIFICACIÓN · Pagos: sueldo fijo + detalle (20261007130000)
-- Reemplazar :periodo por el id del período a controlar.
select 'fn_detalle' chequeo, (to_regprocedure('public.pagos_banco_por_usuario(uuid)') is not null)::text v, 'POST=true' e
union all select 'anon_sin_execute',
  (not has_function_privilege('anon', 'public.pagos_banco_por_usuario(uuid)', 'execute'))::text, 'POST=true';

-- POST: quienes tienen SUELDO MENSUAL cobran ese importe (no el neto de Visual),
-- menos sus adelantos del período (una sola vez).
-- Debe devolver 0 filas.
select d.nombre, d.sueldo, public.sueldo_mensual_vigente(d.usuario_id, p.mes) sm
from public.liquidacion_periodo p, public.pagos_banco_por_usuario(p.id) d
where p.id = :periodo and d.sueldo_fijo
  and d.sueldo <> greatest(round(public.sueldo_mensual_vigente(d.usuario_id, p.mes), 2) - coalesce(d.adelantos, 0), 0);

-- POST: los archivos del banco salen del detalle (totales iguales).
select (select coalesce(sum(importe),0) from public.pagos_sueldos_banco(:periodo)) archivo_sueldos,
       (select coalesce(sum(sueldo),0) from public.pagos_banco_por_usuario(:periodo) where sueldo <> 0) detalle_sueldos,
       (select coalesce(sum(importe),0) from public.pagos_extras_banco(:periodo)) archivo_extras,
       (select coalesce(sum(extras),0) from public.pagos_banco_por_usuario(:periodo)) detalle_extras;
