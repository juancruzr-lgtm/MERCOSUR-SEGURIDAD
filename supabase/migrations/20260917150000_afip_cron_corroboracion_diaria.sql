-- Cron diario de la corroboración de empleados contra el Padrón A13.
--
-- Corre UNA VEZ POR DÍA (lo que pidió JC: "que corrobore 1 vez por día"). A las
-- 09:00 UTC = 06:00 ART, antes del arranque administrativo.
--
-- EL SECRETO NO SE ESCRIBE ACÁ: se toma del job de /api/push/notificaciones,
-- cambiándole la URL, igual que el resto de los crons. Así no queda una segunda
-- copia del CRON_SECRET ni escrita en una migración versionada.
--
-- NO APLICAR hasta que: (1) estén cargados los secretos AFIP_* en Vercel y
-- (2) WSAA de PRODUCCIÓN autentique (el certificado ya propagó). Antes de eso la
-- corrida sólo va a registrar el error de WSAA.

do $BODY$
declare
  v_command text;
begin
  v_command := (
    select replace(j.command, '/api/push/notificaciones', '/api/afip/corroborar-empleados')
      from cron.job j
     where j.command like '%/api/push/notificaciones%'
     limit 1
  );

  if v_command is null then
    raise exception 'No existe el job de /api/push/notificaciones: de ahí sale el secreto';
  end if;

  perform cron.unschedule('afip_corroborar_empleados')
   where exists (select 1 from cron.job where jobname = 'afip_corroborar_empleados');

  perform cron.schedule('afip_corroborar_empleados', '0 9 * * *', v_command);
end;
$BODY$;
