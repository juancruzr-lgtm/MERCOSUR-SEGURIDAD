-- RONDAS — Obligaciones reales por empleado en agosto.
-- Solo lectura.
--
-- Al denominador entran SOLO obligaciones validas y atribuibles. Se excluyen
-- las alertas saneadas administrativamente el 24/08: cerrarlas fue un acto de
-- limpieza, no un incumplimiento del vigilador, y volver a contarlas seria
-- castigar dos veces por lo mismo.
--
-- rondas_ventanas_programadas() es la definicion unica de la obligacion: la
-- misma que usan el evaluador de alertas y el historial. No se reimplementa.
with ventanas as (
  select v.*
  from rondas_ventanas_programadas(
         null,
         date '2026-08-01',
         date '2026-08-31') v
  where v.vencimiento_at < now()
), alertas as (
  select a.turno_id, a.ronda_base_id, a.ventana_inicio, a.tipo, a.estado,
         coalesce(a.comentario, '') like 'Saneamiento administrativo%' as saneada
  from ronda_alertas a
  where a.ventana_inicio >= '2026-08-01'
    and a.ventana_inicio <  '2026-09-01'
)
select
  u.apellido || ', ' || u.nombre                                   as empleado,
  count(*)                                                         as obligaciones,
  count(*) filter (where al.turno_id is null)                      as cumplidas,
  count(*) filter (where al.tipo = 'no_iniciada'   and not al.saneada) as no_iniciada,
  count(*) filter (where al.tipo = 'no_finalizada' and not al.saneada) as no_finalizada,
  count(*) filter (where al.tipo = 'suspendida'    and not al.saneada) as suspendida,
  count(*) filter (where al.saneada)                               as saneadas_excluir
from ventanas v
join usuarios u on u.id = v.guardia_id
left join alertas al
       on al.turno_id = v.turno_id
      and al.ronda_base_id = v.ronda_base_id
      and al.ventana_inicio = v.ventana_inicio
group by 1
order by no_iniciada desc, obligaciones desc;
