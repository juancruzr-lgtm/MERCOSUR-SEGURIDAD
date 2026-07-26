-- Solo lectura. Ejecutar antes de la migración correctiva.

select count(*) as rondas_existentes
from public.rondas_base;

select
  rb.id as ronda_id,
  rb.nombre as ronda_nombre,
  rb.objetivo_id,
  o.nombre as objetivo_nombre,
  count(p.id) as cantidad_puestos,
  coalesce(
    jsonb_agg(
      jsonb_build_object('id', p.id, 'nombre', p.nombre, 'activo', p.activo)
      order by p.orden nulls last, p.nombre
    ) filter (where p.id is not null),
    '[]'::jsonb
  ) as puestos
from public.rondas_base rb
join public.objetivos o on o.id = rb.objetivo_id
left join public.puestos p on p.objetivo_id = rb.objetivo_id
group by rb.id, rb.nombre, rb.objetivo_id, o.nombre
order by o.nombre, rb.nombre;

select
  rb.id as ronda_id,
  rb.nombre as ronda_nombre,
  o.id as objetivo_id,
  o.nombre as objetivo_nombre,
  count(p.id) as cantidad_puestos
from public.rondas_base rb
join public.objetivos o on o.id = rb.objetivo_id
left join public.puestos p on p.objetivo_id = rb.objetivo_id
group by rb.id, rb.nombre, o.id, o.nombre
having count(p.id) <> 1
order by o.nombre, rb.nombre;

select o.id, o.nombre
from public.objetivos o
where o.estado = 'activo'
  and o.zona_id is null
order by o.nombre;

select u.id, u.nombre, u.apellido
from public.usuarios u
where u.rol = 'supervisor'
  and u.estado = 'activo'
  and not exists (
    select 1 from public.supervisor_zonas sz
    where sz.supervisor_id = u.id
  )
order by u.apellido, u.nombre;

select rb.id as ronda_id, rb.nombre, o.id as objetivo_id, o.nombre as objetivo
from public.rondas_base rb
join public.objetivos o on o.id = rb.objetivo_id
where o.zona_id is null
order by o.nombre, rb.nombre;
