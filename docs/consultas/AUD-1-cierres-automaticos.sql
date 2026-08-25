-- AUDITORIA 1 de 3 — Cierres automaticos: ¿es el sitio o es la persona?
-- Solo lectura. No corrige nada.
--
-- El discriminador es la concentracion: si en un objetivo TODOS los empleados
-- tienen cierre automatico, el problema es del sitio (senal, procedimiento de
-- salida, dispositivo). Si es uno solo entre varios, es de la persona.
select
  o.nombre                                                        as objetivo,
  count(*)                                                        as turnos,
  count(*) filter (where ra.cierre_automatico)                    as auto,
  round(100.0 * count(*) filter (where ra.cierre_automatico) / count(*)) as pct_auto,
  count(distinct t.guardia_id)                                    as empleados,
  count(distinct t.guardia_id) filter (where ra.cierre_automatico) as empleados_con_auto
from turnos t
join objetivos o on o.id = t.objetivo_id
left join registros_asistencia ra
       on ra.turno_id = t.id and ra.cobertura_anulada_at is null
where t.fecha between '2026-08-01' and '2026-08-31'
  and o.es_prueba = false
  and t.guardia_id is not null
group by 1
having count(*) filter (where ra.cierre_automatico) > 0
order by pct_auto desc, auto desc;
