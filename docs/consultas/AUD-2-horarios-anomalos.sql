-- AUDITORIA 2 de 3 — Horarios programados vs entrada real
-- Solo lectura. No corrige nada.
--
-- Si el desvio promedio es grande Y consistente (poca distancia entre la
-- entrada mas temprana y la mas tardia), el horario programado no representa
-- el horario operativo real: la persona no llega tarde, el turno esta mal
-- cargado. Si el desvio es erratico, si es impuntualidad.
select
  u.apellido || ', ' || u.nombre                      as empleado,
  o.nombre                                            as objetivo,
  t.hora_inicio::text                                 as programado,
  count(*)                                            as turnos,
  to_char(avg(ra.hora_entrada_real - t.hora_inicio), 'HH24:MI:SS') as desvio_promedio,
  min(ra.hora_entrada_real)::text                     as entrada_mas_temprana,
  max(ra.hora_entrada_real)::text                     as entrada_mas_tardia,
  count(*) filter (where ra.alerta_entrada = 'tarde') as marcadas_tarde
from turnos t
join usuarios u on u.id = t.guardia_id
join objetivos o on o.id = t.objetivo_id
join registros_asistencia ra
  on ra.turno_id = t.id
 and ra.hora_entrada_real is not null
 and ra.cobertura_anulada_at is null
where t.fecha between '2026-08-01' and '2026-08-31'
  and (u.apellido ilike 'CONTARDE' or u.apellido ilike 'OJEDA' or u.apellido ilike 'GALLO')
group by 1, 2, 3
order by 1, 2, 3;
