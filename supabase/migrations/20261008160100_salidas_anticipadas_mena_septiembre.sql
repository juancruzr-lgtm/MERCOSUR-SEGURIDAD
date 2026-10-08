-- Caso MENA, septiembre 2026: documentar las salidas anticipadas.
--
-- Corrección individual ordenada por Gerencia el 08/10/2026 para Roberto
-- Carlos MENA (MUSEO MACRO). La regla general es prospectiva y NO se extiende
-- a septiembre para nadie más: este archivo sólo registra las salidas de esta
-- persona en este período.
--
-- Las deja en estado 'detectada', que no tiene efecto sobre la nota. Confirmar
-- que son injustificadas lo hace una persona con nombre desde la bandeja de
-- Salidas anticipadas (resolver_salidas_anticipadas), y la corrección de la
-- evaluación publicada la aplica Gerencia (corregir_evaluacion_publicada).
-- Ninguno de esos dos pasos ocurre acá.
--
-- Requiere 20261008160000_salidas_anticipadas.sql. Idempotente.
--
-- Verificado el 08/10/2026 antes de escribirlo: 21 jornadas, todas con salida
-- antes del fin programado; sin autorizaciones, observaciones, novedades
-- laborales ni correcciones de horario registradas en el período.

begin;

insert into public.salidas_anticipadas (
  registro_id, turno_id, empleado_id, objetivo_id, fecha, periodo,
  fin_programado, salida_registrada, segundos_antes, minutos_antes
)
select ra.id, t.id, t.guardia_id, t.objetivo_id, t.fecha, to_char(t.fecha, 'YYYY-MM'),
       i.fin_programado, i.salida,
       floor(extract(epoch from (i.fin_programado - i.salida)))::integer,
       floor(extract(epoch from (i.fin_programado - i.salida)))::integer / 60
  from public.turnos t
  join public.registros_asistencia ra
    on ra.turno_id = t.id and ra.registro_anulado_at is null
  cross join lateral public.salida_anticipada_instantes(
    t.fecha, t.hora_inicio, t.hora_fin, ra.hora_salida_real) i
 where t.guardia_id = '829c3f6c-1d32-4fd5-a752-cdeb05741dde'   -- MENA, Roberto Carlos
   and t.fecha between date '2026-09-01' and date '2026-09-30'
   and t.estado not in ('anulado','cancelado','reemplazado')
   and ra.hora_entrada_real is not null
   and ra.hora_salida_real is not null
   and not coalesce(ra.cierre_automatico, false)
   and i.salida < i.fin_programado
on conflict (registro_id) do nothing;

commit;

-- Verificación (ejecutar aparte): 21 filas esperadas.
-- select fecha, fin_programado::time as fin, salida_registrada::time as salida,
--        minutos_antes, segundos_antes, estado
--   from public.salidas_anticipadas
--  where empleado_id = '829c3f6c-1d32-4fd5-a752-cdeb05741dde' and periodo = '2026-09'
--  order by fecha;
