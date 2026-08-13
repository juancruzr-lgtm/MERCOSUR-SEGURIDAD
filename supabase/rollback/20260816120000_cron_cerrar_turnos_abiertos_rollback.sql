-- ROLLBACK de 20260816120000_cron_cerrar_turnos_abiertos.sql
--
-- Saca el job de pg_cron. La funcion cerrar_turnos_abiertos() NO se toca:
-- sigue existiendo y se puede seguir llamando a mano o desde /api/push/cron.
--
-- Los registros ya cerrados NO se revierten: quedan con hora_salida_final =
-- hora_fin del turno y cierre_automatico = true. Eso es correcto —ese cierre
-- ya fue visto y posiblemente aceptado por el vigilador—. Si hiciera falta
-- deshacer un cierre puntual, se corrige por el camino normal (correccion de
-- horario reconocido, con motivo y auditoria), nunca con un UPDATE masivo.

select cron.unschedule('cerrar-turnos-abiertos')
where exists (select 1 from cron.job where jobname = 'cerrar-turnos-abiertos');
