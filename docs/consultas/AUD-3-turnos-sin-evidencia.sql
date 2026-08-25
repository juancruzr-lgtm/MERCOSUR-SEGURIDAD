-- AUDITORIA 3 de 3 — Los turnos sin evidencia alguna
-- Solo lectura. No corrige nada.
--
-- Turnos exigibles, ya terminados, con guardia asignado, sin ningun registro
-- de asistencia. Hoy salen del denominador (no son faltas), pero alguien
-- deberia saber por que no tienen registro.
--
-- Se trae el estado y el tipo de evento para poder clasificar la causa sin
-- suponerla: capacitacion, cobertura que no se cargo, turno que no ocurrio.
select
  u.apellido || ', ' || u.nombre                as empleado,
  t.fecha::text                                 as fecha,
  o.nombre                                      as objetivo,
  t.hora_inicio::text || '-' || t.hora_fin::text as horario,
  coalesce(t.estado, '(sin estado)')            as estado_turno,
  coalesce(t.tipo_evento, '-')                  as tipo_evento,
  case when t.guardia_original_id is not null
        and t.guardia_original_id <> t.guardia_id
       then 'si' else 'no' end                  as hubo_reemplazo
from turnos t
join objetivos o on o.id = t.objetivo_id
join usuarios u on u.id = t.guardia_id
where t.fecha between '2026-08-01' and '2026-08-31'
  and o.es_prueba = false
  and t.guardia_id is not null
  and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
  and (t.fecha + t.hora_fin
       + case when t.hora_fin <= t.hora_inicio then interval '1 day'
              else interval '0' end) < now()
  and not exists (
    select 1 from registros_asistencia ra
     where ra.turno_id = t.id and ra.cobertura_anulada_at is null)
order by 1, 2;
