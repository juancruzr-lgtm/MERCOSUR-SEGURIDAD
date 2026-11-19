-- Verificación posterior a 20261218120000. Sólo lectura.
-- 1. Tabla con RLS (rls = true)
select relname, relrowsecurity from pg_class where relname = 'ronda_guiada';
-- 2. Ninguna solicitud todavía (0)
select count(*) from public.ronda_guiada;
-- 3. authenticated no puede ejecutar la activación automática (false)
select has_function_privilege('authenticated', 'public.ronda_guiada_activar_vencidas()', 'execute');
-- 4. Ningún cron nuevo (0 filas)
select jobname from cron.job where jobname ilike '%ronda_guiada%';
