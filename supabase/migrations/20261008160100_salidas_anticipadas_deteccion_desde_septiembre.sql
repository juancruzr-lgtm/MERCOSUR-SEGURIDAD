-- Detección de las salidas anticipadas ya fichadas desde septiembre de 2026.
--
-- Orden definitiva de Gerencia (08/10/2026): el criterio se aplica de forma
-- uniforme desde septiembre de 2026, a todos los vigiladores, sin excepciones
-- ni correcciones individuales. El trigger de 20261008160000 detecta lo que se
-- fiche de ahora en más; este archivo registra lo ya fichado desde el
-- 01/09/2026 con la MISMA regla (salida real anterior al fin programado,
-- excluidos cierres automáticos, registros anulados y turnos que no debían
-- existir).
--
-- Todo queda en estado 'detectada', que no tiene efecto sobre la nota. Nada se
-- confirma acá: la confirmación es humana (Supervisión en su zona; abandono,
-- sólo superiores habilitados), y recién ahí se recalcula la evaluación.
--
-- No toca períodos anteriores a septiembre. Idempotente.
-- Requiere 20261008160000_salidas_anticipadas.sql.

begin;

insert into public.salidas_anticipadas (
  registro_id, turno_id, empleado_id, objetivo_id, fecha, periodo,
  fin_programado, salida_registrada, segundos_antes, minutos_antes
)
select ra.id, t.id, coalesce(ra.guardia_id, t.guardia_id), t.objetivo_id, t.fecha, to_char(t.fecha, 'YYYY-MM'),
       i.fin_programado, i.salida,
       floor(extract(epoch from (i.fin_programado - i.salida)))::integer,
       floor(extract(epoch from (i.fin_programado - i.salida)))::integer / 60
  from public.turnos t
  join public.registros_asistencia ra
    on ra.turno_id = t.id and ra.registro_anulado_at is null
  cross join lateral public.salida_anticipada_instantes(
    t.fecha, t.hora_inicio, t.hora_fin, ra.hora_salida_real) i
 where t.fecha >= date '2026-09-01'
   and t.estado not in ('anulado','cancelado','reemplazado')
   and t.hora_inicio is not null and t.hora_fin is not null
   and coalesce(ra.guardia_id, t.guardia_id) is not null
   and ra.hora_entrada_real is not null
   and ra.hora_salida_real is not null
   and not coalesce(ra.cierre_automatico, false)
   and i.salida < i.fin_programado
on conflict (registro_id) do nothing;

commit;

-- Verificación (ejecutar aparte):
-- select periodo, estado, count(*), count(distinct empleado_id)
--   from public.salidas_anticipadas group by 1, 2 order by 1, 2;
