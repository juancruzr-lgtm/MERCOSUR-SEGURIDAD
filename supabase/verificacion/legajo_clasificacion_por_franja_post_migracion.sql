-- Verificación posterior a aplicar 20261105120000 (clasificación por franja).
-- Una sola consulta de lectura. Corre como usuario de la base (sin sesión), así
-- que lee las tablas directamente con la misma regla que la función.
-- Los totales de José Luis y Aranda son los de la auditoría del 20/10: si
-- alguien edita esas supervisiones o el calendario de octubre, cambian.
-- Si alguna fila da ok = false, NO desplegar.

with
f as (select p.oid, p.prosecdef, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('legajo_supervisores_supervisiones_v2', 'legajo_supervisores_guardias', 'legajo_supervisores_supervisiones')),
c1 as (select count(*) n from f where prosecdef),
c2 as (select count(*) n from f where proname = 'legajo_supervisores_supervisiones_v2' and has_function_privilege('anon', oid, 'execute')),
c3 as (select count(*) n from f where proname = 'legajo_supervisores_supervisiones_v2' and has_function_privilege('authenticated', oid, 'execute')),
c4 as (select case when pg_get_functiondef('public.legajo_supervisores_supervisiones_v2(uuid,date,date)'::regprocedure)
                        ilike '%puede_ver_legajo_supervisores_actual()%' then 1 else 0 end n),
-- totales reales: se recalculan con la función, como usuario autorizado simulado no es posible
-- desde el editor; por eso esta parte se corre aparte con sesión simulada (ver PR).
c5 as (select 1 n)
select 1 o, '3 funciones del legajo SECURITY DEFINER (v2, guardias y la vieja intacta)' control, '3' esperado, n::text obtenido, n = 3 ok from c1
union all select 2, 'v2 sin execute para anon', '0', n::text, n = 0 from c2
union all select 3, 'v2 con execute para authenticated', '1', n::text, n = 1 from c3
union all select 4, 'v2 pide el permiso de las 7 personas', '1', n::text, n = 1 from c4
union all select 5, 'José Luis 01–20/10: en turno / cubrió / sin prog. / fuera', '58/70/0/0', 'ver sesión simulada', true from c5
union all select 6, 'Aranda 01–20/10: en turno / cubrió / sin prog. / fuera', '109/109/7/2', 'ver sesión simulada', true from c5
order by 1;

-- Sesión simulada (correr aparte, sólo lectura), como una de las 7 personas:
--   select set_config('request.jwt.claims', json_build_object('sub',
--     (select auth_user_id from usuarios where id='3a8e3c04-f4f5-48c4-8830-73edccb73667'), 'role','authenticated')::text, true);
--   set local role authenticated;
--   select supervisor, situacion, cobertura, count(*)
--     from legajo_supervisores_supervisiones_v2(null, date '2026-10-01', date '2026-10-20')
--    group by 1, 2, 3 order by 1, 2, 3;
-- Esperado (20/10): José Luis 58 en_turno, 70 cubrio_otro (6 confirmada_programacion,
-- 52 confirmada_evidencia, 12 probable); Aranda 109 en_turno, 109 cubrio_otro
-- (confirmada_evidencia), 7 sin_programacion, 2 fuera_turno.
