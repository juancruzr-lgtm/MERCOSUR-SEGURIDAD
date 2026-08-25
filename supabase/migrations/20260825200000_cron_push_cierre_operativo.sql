-- Cron del aviso de Cierre Operativo Diario.
--
-- POR QUE CADA 15 MINUTOS Y NO A UNA HORA FIJA
-- El aviso sale cuando termina la guardia de CADA responsable, y cada uno
-- termina a una hora distinta —hoy 07:00, 13:00 y 19:00, y eso puede cambiar
-- manana sin que nadie toque este archivo—. Un horario fijo le llegaria a
-- destiempo a todo el que no cierre justo a esa hora, y como la deduplicacion
-- es por (usuario, dia), ese aviso a destiempo le consumiria el del final de SU
-- guardia. Por eso corre seguido y la ruta decide en cada corrida.
--
-- Los 15 minutos coinciden con la tolerancia de la ruta (TOLERANCIA_CRON_MIN):
-- asi ningun fin de guardia cae entre dos corridas sin que nadie lo alcance.
--
-- POR QUE NO ES CARO
-- La ruta hace primero una sola consulta a supervisores_guardia y, si nadie
-- esta cerrando, contesta sin cargar nada mas. De 96 corridas diarias, unas
-- pocas hacen trabajo real.
--
-- EL SECRETO NO SE ESCRIBE ACA
-- Se toma del job de /api/push/notificaciones, que ya lo tiene, cambiandole la
-- URL. Asi no hay una segunda copia del CRON_SECRET dando vueltas ni queda
-- escrito en una migracion versionada.
--
-- DESFASADO respecto del job de notificaciones (2,12,22,...) para no pegarle a
-- la funcion serverless con dos pedidos en el mismo minuto.

do $BODY$
declare
  v_command text;
begin
  v_command := (
    select replace(j.command, '/api/push/notificaciones', '/api/push/cierre-operativo')
      from cron.job j
     where j.command like '%/api/push/notificaciones%'
     limit 1
  );

  if v_command is null then
    raise exception 'No existe el job de /api/push/notificaciones: de ahi sale el secreto';
  end if;

  perform cron.unschedule('push_cierre_operativo')
   where exists (select 1 from cron.job where jobname = 'push_cierre_operativo');

  perform cron.schedule('push_cierre_operativo', '7,22,37,52 * * * *', v_command);
end;
$BODY$;
