-- PUNTUALIDAD 2 de 2 — Por empleado, con el denominador a la vista.
-- Solo lectura.
--
-- El denominador importa: "80 % de puntualidad" no significa nada sin saber
-- sobre cuantas entradas se calculo. Ademas separa el turno, para poder
-- detectar horarios programados que no representan la operacion real: si TODAS
-- las entradas de un mismo turno caen en la misma banda, el problema es el
-- horario cargado, no la persona.
select
  u.apellido || ', ' || u.nombre                              as empleado,
  t.hora_inicio::text                                         as turno_desde,
  count(*)                                                    as entradas_evaluables,
  count(*) filter (where m <= 5)                              as b_hasta_5,
  count(*) filter (where m > 5  and m <= 15)                  as b_6_15,
  count(*) filter (where m > 15 and m <= 30)                  as b_16_30,
  count(*) filter (where m > 30)                              as b_mas_30,
  round(avg(m))                                               as promedio_min,
  round(min(m))                                               as minimo,
  round(max(m))                                               as maximo
from (
  select
    t.guardia_id, t.hora_inicio,
    extract(epoch from (ra.hora_entrada_real - t.hora_inicio)) / 60
      + case
          when t.hora_fin <= t.hora_inicio
           and ra.hora_entrada_real < t.hora_inicio
          then 1440 else 0
        end                                                   as m
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
) t
join usuarios u on u.id = t.guardia_id
group by 1, 2
having count(*) filter (where m > 5) > 0
order by b_mas_30 desc, b_16_30 desc, 1;
