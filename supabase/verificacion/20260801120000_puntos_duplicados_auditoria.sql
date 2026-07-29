-- AUDITORÍA (solo lectura): pares de puntos ACTIVOS de una misma ronda a < 3 m.
-- No borra ni modifica nada. Revisar y corregir manualmente los casos que salgan.
select
  a.ronda_base_id,
  rb.nombre                                  as ronda,
  o.nombre                                   as objetivo,
  a.id as punto_a_id, a.orden as orden_a, a.nombre as nombre_a,
  b.id as punto_b_id, b.orden as orden_b, b.nombre as nombre_b,
  round(public.rondas_distancia_metros(a.latitud, a.longitud, b.latitud, b.longitud)::numeric, 2) as distancia_m
from public.ronda_puntos a
join public.ronda_puntos b
  on  b.ronda_base_id = a.ronda_base_id
  and b.id > a.id
join public.rondas_base rb on rb.id = a.ronda_base_id
join public.objetivos   o  on o.id = rb.objetivo_id
where a.activo and b.activo
  and a.latitud is not null and a.longitud is not null
  and b.latitud is not null and b.longitud is not null
  and public.rondas_distancia_metros(a.latitud, a.longitud, b.latitud, b.longitud) < 3
order by a.ronda_base_id, distancia_m;
