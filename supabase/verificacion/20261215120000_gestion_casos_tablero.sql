-- Verificación posterior a 20261215120000_gestion_casos_tablero. Sólo lectura.
-- Resultado esperado indicado en cada consulta.

-- 1. Tablas creadas con RLS (4 filas, rls = true)
select relname, relrowsecurity as rls from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('gestion_reglas', 'gestion_casos', 'gestion_caso_eventos', 'gestion_comunicaciones');

-- 2. Reglas: 7 existentes, 7 propuestas, ninguna aprobada
select estado, count(*) from public.gestion_reglas group by estado order by estado;

-- 3. authenticated no puede escribir directo (0 filas)
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'authenticated' and table_name like 'gestion_%' and privilege_type <> 'SELECT';

-- 4. Ninguna comunicación enviada ni autorizada (0 filas)
select estado, count(*) from public.gestion_comunicaciones where estado <> 'preparada' group by estado;

-- 5. Ningún cron nuevo relacionado (0 filas)
select jobname from cron.job where jobname ilike '%gestion%';

-- 6. Tablas operativas intactas: comparar con la foto previa a aplicar
select (select count(*) from public.turnos) turnos,
       (select count(*) from public.registros_asistencia) registros,
       (select count(*) from public.ronda_alertas) ronda_alertas,
       (select count(*) from public.liquidacion_periodo) liquidaciones;
