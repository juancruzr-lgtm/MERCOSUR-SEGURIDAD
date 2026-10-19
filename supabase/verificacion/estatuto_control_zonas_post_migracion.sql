-- Verificación después de aplicar 20261027120000_estatuto_control_zonas.sql.
-- Una sola sentencia (el editor de Supabase muestra sólo el último select).
-- Todo debe dar ok = true. No escribe nada.
select 'estatuto_control menciona zonas' as control,
       (pg_get_functiondef('public.estatuto_control(uuid)'::regprocedure) ilike '%supervisor_zonas%') as ok,
       null::text as detalle
union all
select 'sigue siendo SECURITY DEFINER',
       (select p.prosecdef from pg_proc p where p.oid = 'public.estatuto_control(uuid)'::regprocedure),
       null
union all
select 'anon no la ejecuta',
       not has_function_privilege('anon', 'public.estatuto_control(uuid)', 'execute'),
       null
union all
select 'authenticated la ejecuta',
       has_function_privilege('authenticated', 'public.estatuto_control(uuid)', 'execute'),
       null
union all
-- Cuántos activos (sin prueba) tendrían zona con la regla nueva. Referencia
-- del 16/10: 76 con zona por turnos, 2 en dos zonas, 3 guardias sin zona.
select 'activos con al menos una zona',
       true,
       (select count(*)::text from public.usuarios u
         where u.estado = 'activo' and coalesce(u.es_prueba, false) = false
           and (exists (select 1 from public.turnos t join public.objetivos o on o.id = t.objetivo_id
                        where t.guardia_id = u.id and t.fecha between current_date - 60 and current_date + 30
                          and coalesce(t.estado, '') <> 'anulado' and o.zona_id is not null)
                or exists (select 1 from public.supervisor_zonas sz where sz.supervisor_id = u.id)))
       || ' de ' ||
       (select count(*)::text from public.usuarios u where u.estado = 'activo' and coalesce(u.es_prueba, false) = false)
union all
select 'constancias intactas (no cambia nada de la aceptación)',
       true,
       (select count(*)::text from public.estatuto_aceptaciones) || ' aceptaciones, '
       || (select count(*)::text from public.estatuto_aperturas) || ' aperturas';
