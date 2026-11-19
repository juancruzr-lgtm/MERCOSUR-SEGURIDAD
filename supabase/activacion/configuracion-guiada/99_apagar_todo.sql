-- APAGADO DE EMERGENCIA · corta los avisos automáticos y el pedido automático.
-- No borra nada: las rondas ya creadas siguen como están (desactivarlas, si
-- hace falta, desde Configurar objetivos con motivo).
select cron.unschedule(jobname) from cron.job where jobname in ('whatsapp-objetivo-sin-configurar', 'ronda-guiada-avisos');
update public.ronda_guiada_config set pedido_automatico = false, actualizado_at = now();
