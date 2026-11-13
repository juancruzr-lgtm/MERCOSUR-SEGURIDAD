-- Rollback de 20261214100000: vuelve pagos_banco_destinatarios() a la versión
-- previa (sin excluir a las bajas confirmadas). Aplicar SÓLO si hace falta
-- revertir. No se ejecuta junto con la migración.

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
      when coalesce(u.excluir_pago_banco, false) then 'excluido del pago por banco (baja)'
      when nullif(btrim(u.cuenta_bancaria), '') is null then 'sin cuenta bancaria cargada'
    end as motivo) m
  where not coalesce(u.es_prueba, false);
end;
$function$;
