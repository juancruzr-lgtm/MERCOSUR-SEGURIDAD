-- PASO 1 · Destinatarios fijos de los avisos (Gerencia, Director técnico,
-- Jefe de supervisores). El supervisor de la zona se suma solo.
-- Requiere 20261218120000 aplicada. Falla si no encuentra exactamente a los 3.
begin;
do $$
declare v_ids uuid[];
begin
  select array_agg(id order by puesto_organizacional) into v_ids
  from public.usuarios
  where estado = 'activo' and (
       (lower(nombre) like 'juan cruz%' and lower(apellido) = 'romero' and puesto_organizacional = 'gerencia')
    or (lower(nombre) = 'rodolfo' and lower(apellido) = 'romero' and puesto_organizacional = 'direccion_operativa')
    or (lower(nombre) = 'aldo' and lower(apellido) in ('monzon', 'monzón') and puesto_organizacional = 'jefe_supervisores'));
  if coalesce(array_length(v_ids, 1), 0) <> 3 then
    raise exception 'Se esperaban 3 destinatarios y se encontraron %', coalesce(array_length(v_ids, 1), 0);
  end if;
  update public.ronda_guiada_config set avisar_usuarios = v_ids, actualizado_at = now();
end $$;
select u.nombre, u.apellido, u.puesto_organizacional
from public.ronda_guiada_config c, unnest(c.avisar_usuarios) x join public.usuarios u on u.id = x;
commit;
