-- Cron del aviso preventivo de agenda de supervisores.
--
-- QUE DISPARA
-- /api/push/agenda-supervisores: si MAÑANA quedan franjas sin supervisor de
-- guardia en supervisores_guardia, avisa por push a la lista de escalamiento
-- (jefe de supervisores + direccion). Nacio del hueco de octubre 2026: el
-- 03/10 quedo el dia entero sin guardia diurna y las alertas de ronda no
-- tuvieron a quien escalarse por WhatsApp durante horas.
--
-- CUANDO
-- Una vez por dia a las 20:00 UTC (17:00 de Argentina): con la tarde por
-- delante para completar la programacion. La ruta deduplica por
-- (usuario, agenda_supervisores:fecha), asi que correrlo de mas no duplica.
--
-- EL SECRETO NO SE ESCRIBE ACA
-- Se toma del job de /api/push/notificaciones cambiandole la URL, igual que
-- hizo el cron del Cierre Operativo. Asi no queda una segunda copia del
-- secreto en una migracion versionada.
--
-- ROLLBACK: supabase/rollback/20261005180000_cron_push_agenda_supervisores_rollback.sql
-- Idempotente: si.

do $BODY$
declare
  v_command text;
begin
  v_command := (
    select replace(j.command, '/api/push/notificaciones', '/api/push/agenda-supervisores')
      from cron.job j
     where j.command like '%/api/push/notificaciones%'
     limit 1
  );

  if v_command is null then
    raise exception 'No existe el job de /api/push/notificaciones: de ahi sale el secreto';
  end if;

  perform cron.unschedule('push_agenda_supervisores')
   where exists (select 1 from cron.job where jobname = 'push_agenda_supervisores');

  perform cron.schedule('push_agenda_supervisores', '0 20 * * *', v_command);
end;
$BODY$;
