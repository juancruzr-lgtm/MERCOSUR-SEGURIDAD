-- Deduplicación del resumen de Cierre Operativo Diario.
--
-- notificaciones_enviadas ya deduplica por (usuario, turno, tipo) y por
-- (usuario, objetivo, tipo). El resumen del cierre no cuelga de ninguno de los
-- dos: es una foto del día entero, y su unicidad natural es (usuario, día).
--
-- El día viaja dentro de `tipo` ("cierre_operativo:2026-08-25"), así que este
-- índice sobre (usuario_id, tipo) para las filas sin turno ni objetivo alcanza
-- para que un segundo intento no vuelva a avisar. La ruta ya chequea antes de
-- mandar; esto es la garantía de la base para cuando dos corridas se pisen.
--
-- No modifica ninguna fila existente ni toca los otros dos índices.

create unique index if not exists notificaciones_enviadas_usuario_tipo_dia_key
  on notificaciones_enviadas (usuario_id, tipo)
  where turno_id is null and objetivo_id is null;
