-- Verificación posterior a aplicar 20261103120000 (GPS: registro por puesto de supervisor).
-- Una sola consulta de lectura. Si alguna fila da ok = false, NO desplegar.

with
pol as (select * from pg_policies where schemaname = 'public' and tablename = 'supervisor_route_points'),
ins as (select * from pol where policyname = 'Supervisor inserta sus propios puntos GPS'),
u as (select id, rol, puesto_organizacional p from public.usuarios),
regla as (select id, (rol = 'supervisor') antes, (rol = 'supervisor' or p in ('supervisor', 'jefe_supervisores')) ahora from u),
c1 as (select count(*) n from ins where cmd = 'INSERT' and 'authenticated' = any(roles)),
c2 as (select count(*) n from ins where with_check ilike '%jefe_supervisores%' and with_check ilike '%supervisor_route_points.supervisor_id%'),
c3 as (select count(*) n from pol),
c4 as (select count(*) n from pol where policyname in ('Admin lee todos los recorridos', 'Supervisor lee sus propios recorridos') and cmd = 'SELECT'),
c5 as (select count(*) n from regla where antes and not ahora),
c6 as (select string_agg(id::text, ',') v from regla where ahora and not antes)
select 1 o, 'Política de INSERT para authenticated' control, '1' esperado, n::text obtenido, n = 1 ok from c1
union all select 2, 'Sigue exigiendo que el punto sea propio y suma el puesto', '1', n::text, n = 1 from c2
union all select 3, 'Siguen siendo 3 políticas', '3', n::text, n = 3 from c3
union all select 4, 'Lecturas sin cambios (Admin y Supervisor)', '2', n::text, n = 2 from c4
union all select 5, 'Nadie pierde el permiso de registrar', '0', n::text, n = 0 from c5
union all select 6, 'Se suma sólo Sergio Martínez', '69493cc2-15d6-4618-893e-4a9b1d044df8', v, v = '69493cc2-15d6-4618-893e-4a9b1d044df8' from c6
order by 1;
