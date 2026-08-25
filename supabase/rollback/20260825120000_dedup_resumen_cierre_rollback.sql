-- Rollback de 20260825120000_dedup_resumen_cierre.sql
--
-- Sólo quita el índice. No borra ninguna fila de notificaciones_enviadas: el
-- historial de qué se avisó y a quién se conserva.
--
-- ARCHIVO APARTE A PROPÓSITO: no se pega junto a la migración, porque un bloque
-- SQL se ejecuta entero y desharía lo que se acaba de aplicar.

drop index if exists notificaciones_enviadas_usuario_tipo_dia_key;
