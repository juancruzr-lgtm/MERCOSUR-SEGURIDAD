-- PUNTUALIDAD 1 de 2 — Bandas reales de agosto, con el universo de la V2.
-- Solo lectura. No corrige nada, no toca calcAlertaEntrada ni tolerancias.
--
-- El indicador necesita su propio criterio analitico: la alerta operativa marca
-- "tarde" con mas de 5 minutos, que sirve para avisar en el momento pero no
-- para evaluar un mes. Esto mide los minutos reales para poder decidir bandas.
select
  case
    when m <= 0            then '0-en hora o antes'
    when m <= 5            then '1-hasta 5 min'
    when m <= 15           then '2-de 6 a 15 min'
    when m <= 30           then '3-de 16 a 30 min'
    when m <= 120          then '4-mas de 30 min'
    else                        '5-mas de 2 horas (sospechoso)'
  end                                             as banda,
  count(*)                                        as entradas,
  count(distinct empleado_id)                     as empleados,
  round(avg(m))                                   as demora_promedio_min
from (
  select
    t.guardia_id as empleado_id,
    extract(epoch from (ra.hora_entrada_real - t.hora_inicio)) / 60
      + case
          when t.hora_fin <= t.hora_inicio
           and ra.hora_entrada_real < t.hora_inicio
          then 1440 else 0
        end                                       as m
  from turnos t
  join objetivos o on o.id = t.objetivo_id
  join registros_asistencia ra
    on ra.turno_id = t.id
   and ra.hora_entrada_real is not null
   and ra.cobertura_anulada_at is null
  where t.fecha between '2026-08-01' and '2026-08-31'
    and o.es_prueba = false
    and t.guardia_id is not null
    and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
    and (t.fecha + t.hora_fin
         + case when t.hora_fin <= t.hora_inicio then interval '1 day'
                else interval '0' end) < now()
) x
group by 1
order by 1;
