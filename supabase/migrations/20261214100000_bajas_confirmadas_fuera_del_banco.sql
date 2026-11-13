-- Bajas confirmadas fuera de los archivos del banco (JC 13/11)
--
-- Toda baja laboral CONFIRMADA se paga por su liquidación final, no por el
-- archivo mensual. Hasta ahora una baja sólo quedaba afuera del banco si estaba
-- inactiva o marcada `excluir_pago_banco`; si se confirmaba la baja pero todavía
-- no se le hacía la final y seguía activa, se le podía pagar el sueldo/extra del
-- mes por el banco (doble pago con la final).
--
-- `pagos_banco_destinatarios()` es la fuente ÚNICA de los dos archivos
-- (sueldos vía pagos_banco_por_usuario, extras vía la conciliación), así que
-- excluir acá a quien tiene una baja confirmada los saca de AMBOS de una.
-- No toca `excluir_pago_banco` (sigue valiendo para exclusiones manuales).

CREATE OR REPLACE FUNCTION public.pagos_banco_destinatarios()
 RETURNS TABLE(usuario_id uuid, cuenta text, nombre text, orden integer, habilitado boolean, motivo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if auth.uid() is not null and not public.puede_liquidar_actual() then
    raise exception 'Sólo Gerencia/Administración puede generar el archivo del banco';
  end if;
  return query
  select u.id, nullif(btrim(u.cuenta_bancaria), ''), u.apellido || ', ' || coalesce(u.nombre, ''),
         public.grupo_orden_banco(u.puesto_organizacional, u.rol),
         m.motivo is null,
         m.motivo
  from public.usuarios u
  cross join lateral (select case
      when u.estado <> 'activo' then 'inactivo'
      when exists (
        select 1 from public.baja_laboral b
        where b.empleado_id = u.id and b.estado = 'confirmada'
      ) then 'baja del mes: se paga por la liquidación final'
      when coalesce(u.excluir_pago_banco, false) then 'excluido del pago por banco (baja)'
      when nullif(btrim(u.cuenta_bancaria), '') is null then 'sin cuenta bancaria cargada'
    end as motivo) m
  where not coalesce(u.es_prueba, false);
end;
$function$;
