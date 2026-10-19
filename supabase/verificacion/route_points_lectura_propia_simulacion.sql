-- Simulación ANTES de aplicar 20261031120000. Sólo lee; no crea ni cambia políticas.
-- Evalúa, por cada usuario admin/supervisor con acceso, cuántos puntos GPS ve por la API
-- con las políticas SELECT de hoy (hoy) y con las de la migración (despues).
-- Esperado: despues = propios en todas las filas; Sergio y demás rol admin pasan de 20.013 a 0.
-- Resultado del 19/10/2026: 14/14 ok (7 admin 20013→0; Fulla 13037, Aranda 6333, J. L. Martínez 643 sin cambio).

with u as (
  select id, auth_user_id, rol, puesto_organizacional::text as puesto,
         nombre || ' ' || coalesce(apellido, '') as quien
  from usuarios
  where auth_user_id is not null and rol in ('admin', 'supervisor')
),
s as (
  select u.quien, u.rol, u.puesto,
    (select count(*) from supervisor_route_points p where
        exists (select 1 from usuarios x where x.auth_user_id = u.auth_user_id and x.id = p.supervisor_id and x.rol = 'supervisor')
     or exists (select 1 from usuarios x where x.auth_user_id = u.auth_user_id and x.rol = 'admin')) as hoy,
    (select count(*) from supervisor_route_points p where
        exists (select 1 from usuarios x where x.auth_user_id = u.auth_user_id and x.id = p.supervisor_id and x.rol = 'supervisor')
     or exists (select 1 from usuarios x where x.auth_user_id = u.auth_user_id and x.id = p.supervisor_id)) as despues,
    (select count(*) from supervisor_route_points p where p.supervisor_id = u.id) as propios,
    coalesce(public.puede_ver_legajo_supervisores(u.id), false) as ve_legajo
  from u
)
select quien, rol, puesto, hoy, despues, propios, ve_legajo, despues = propios as ok
from s
order by rol, quien;
