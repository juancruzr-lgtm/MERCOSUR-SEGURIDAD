-- Programar cerrar_turnos_abiertos() en pg_cron
-- APLICADA EN PRODUCCION: 2026-08-13 (SQL editor)
--
-- EL PROBLEMA
-- cerrar_turnos_abiertos() existe desde 20260721 y dejo de ejecutarse.
--
-- Medido en produccion el 2026-08-13, ANTES de aplicar esto:
--   · 203 registros con cierre_automatico = true  → el mecanismo SI funciono;
--   · el ultimo turno cerrado automaticamente es del 2026-07-30;
--   · 32 registros abiertos y vencidos esperando cierre.
-- O sea: no es que nunca corrio, es que se corto a fines de julio. No quedo
-- registro de que lo disparaba: su unico llamador en el codigo es
-- /api/push/cron, y ese endpoint no tiene scheduler —vercel.json no declara
-- "crons" y el pg_cron de push (20260813180000) dice explicitamente que NO lo
-- llama—. Lo mas probable es un disparador externo que se apago.
--
-- CONSECUENCIA OBSERVADA
-- Un vigilador que ficha entrada y no ficha salida deja el registro con
-- hora_salida_real y hora_salida_final en NULL para siempre. Con eso:
--   · Mi Planilla lo muestra "En curso" y no ofrece NI aceptar NI pedir
--     modificacion (la API deja estado_control en NULL cuando no hay salida),
--     asi que el vigilador no tiene ninguna accion posible sobre ese turno;
--   · Revision de planillas lo cuenta como pendiente indefinidamente, porque
--     sin salida el fichaje nunca cubre el turno.
-- No es un turno mal cargado: es un turno que quedo sin cerrar.
--
-- QUE HACE ESTA MIGRACION
-- Agenda la funcion que ya existe, cada 15 minutos. No la modifica.
-- La funcion ya trae su propia proteccion: solo toca registros con entrada y
-- sin salida, cuyo turno termino hace mas de 30 minutos, y marca
-- cierre_automatico = true para no volver a tocarlos. Es idempotente.
--
-- POR QUE pg_cron DIRECTO Y NO /api/push/cron
-- cerrar_turnos_abiertos() es plpgsql puro: no necesita HTTP, ni pg_net, ni
-- secreto. Llamarla por el endpoint agregaria una llave y una red de por medio
-- para algo que se resuelve dentro de la base. Ademas /api/push/cron tambien
-- manda notificaciones, y aca no se quiere eso.
--
-- OJO AL APLICAR: la primera corrida cierra de una vez TODOS los turnos
-- abiertos historicos —al aplicar eran 32—. Esos turnos hoy valen 0 horas
-- liquidables y pasan a valer su horario PROGRAMADO, asi que las horas del
-- periodo suben de golpe. Si entre los abiertos hay turnos de un mes ya
-- liquidado, se le agregan horas a ese mes: revisar las fechas ANTES, y si
-- hace falta frenar con cron.unschedule y filtrar por fecha.
--
--   select count(*) as se_cerrarian
--   from registros_asistencia r join turnos t on t.id = r.turno_id
--   where r.hora_entrada_real is not null
--     and r.hora_salida_real is null and r.hora_salida_final is null
--     and r.cierre_automatico = false
--     and (t.fecha || ' ' || t.hora_fin)::timestamp
--         at time zone 'America/Argentina/Buenos_Aires' < (now() - interval '30 minutes');
--
-- Rollback: supabase/rollback/20260816120000_cron_cerrar_turnos_abiertos_rollback.sql

-- Idempotente: si el job ya existe se reemplaza el agendamiento.
select cron.unschedule('cerrar-turnos-abiertos')
where exists (select 1 from cron.job where jobname = 'cerrar-turnos-abiertos');

select cron.schedule(
  'cerrar-turnos-abiertos',
  '*/15 * * * *',
  $cron$ select public.cerrar_turnos_abiertos(); $cron$
);
