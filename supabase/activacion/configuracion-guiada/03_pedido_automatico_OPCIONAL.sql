-- PASO 5 (OPCIONAL) · Que el pedido al vigilador salga solo, sin que el
-- supervisor tilde "La ronda la crea el vigilador", para objetivos creados
-- desde ahora. Los objetivos que ya existen NO se ven afectados.
update public.ronda_guiada_config set pedido_automatico = true, objetivos_desde = now(), actualizado_at = now();
select pedido_automatico, objetivos_desde from public.ronda_guiada_config;
