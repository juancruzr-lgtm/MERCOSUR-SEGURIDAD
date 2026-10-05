-- Rollback del cron del aviso preventivo de agenda de supervisores.
-- Deja de correr el chequeo diario; la ruta queda inerte (nadie la llama).

do $BODY$
begin
  perform cron.unschedule('push_agenda_supervisores')
   where exists (select 1 from cron.job where jobname = 'push_agenda_supervisores');
end;
$BODY$;
