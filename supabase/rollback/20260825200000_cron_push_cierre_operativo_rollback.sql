-- Rollback de 20260825200000_cron_push_cierre_operativo.sql
--
-- Apaga el aviso de cierre. La ruta sigue existiendo y se puede seguir
-- simulando con ?simular=1; lo unico que se corta es el disparo automatico.
--
-- No toca los otros jobs ni las notificaciones inmediatas, que son otro
-- circuito. No borra ninguna fila de notificaciones_enviadas: el historial de
-- que se aviso y a quien se conserva.
--
-- ARCHIVO APARTE A PROPOSITO: un bloque SQL se ejecuta entero y desharia lo que
-- se acaba de aplicar.

select cron.unschedule('push_cierre_operativo');
