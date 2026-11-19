-- Verificación posterior a 20261218120000. Sólo lectura.
-- 1. Tablas con RLS (3 filas, rls = true)
select relname, relrowsecurity from pg_class where relname in ('ronda_guiada', 'ronda_guiada_eventos', 'ronda_guiada_config');
-- 2. Pedido automático APAGADO y sin destinatarios cargados todavía
select pedido_automatico, objetivos_desde, avisar_usuarios from public.ronda_guiada_config;
-- 3. Ninguna configuración todavía (0)
select count(*) from public.ronda_guiada;
-- 4. Ninguna frecuencia de ronda cargada todavía (0)
select count(*) from public.objetivos where frecuencia_ronda_minutos is not null;
-- 5. Ningún cron nuevo (0 filas)
select jobname from cron.job where jobname ilike '%ronda_guiada%';
