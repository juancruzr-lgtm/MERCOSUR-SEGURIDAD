-- Simulación del puntaje de desempeño — agosto 2026
--
-- SOLO LECTURA. No escribe, no guarda ningún puntaje, no crea nada.
-- Ver docs/diseno-indicadores-empleados.md
--
-- Son TRES consultas independientes. Correr de a una: el editor SQL del
-- dashboard trunca alrededor de los 4.400 caracteres.
--
-- El universo de turnos es el mismo que usa la bandeja de planillas:
-- objetivo real (no de prueba), turno con obligación (ni reemplazado, ni
-- anulado, ni cancelado) y ya finalizado. Cambiar este criterio cambia todos
-- los denominadores, así que no se toca sin cambiar también la bandeja.


-- ═══════════════════════════════════════════════════════════════════════
-- CONSULTA 1 de 3 — Asistencia, Puntualidad y Procedimiento por empleado
-- ═══════════════════════════════════════════════════════════════════════
with t as (
  select t.id, t.guardia_id
  from turnos t
  join objetivos o on o.id = t.objetivo_id
  where t.fecha between '2026-08-01' and '2026-08-31'
    and t.guardia_id is not null
    and o.es_prueba = false
    and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
    and (t.fecha + t.hora_fin
         + case when t.hora_fin <= t.hora_inicio then interval '1 day'
                else interval '0' end) < now()
), r as (
  select ra.*
  from registros_asistencia ra
  join t on t.id = ra.turno_id
  where ra.cobertura_anulada_at is null
)
select
  u.apellido || ', ' || u.nombre                                        as empleado,
  count(distinct t.id)                                                  as turnos_exigibles,
  count(distinct r.turno_id) filter (
    where coalesce(r.tipo_registro, '') <> 'ausencia')                  as cumplidos,
  count(distinct r.turno_id) filter (
    where r.tipo_registro = 'ausencia')                                 as ausencias,
  count(distinct r.turno_id) filter (
    where r.origen_cobertura like 'confirmacion%')                      as confirmados_sup,
  count(distinct r.turno_id) filter (
    where r.hora_entrada_real is null
      and coalesce(r.tipo_registro, '') <> 'ausencia')                  as sin_fichar_entrada,
  count(distinct r.turno_id) filter (
    where r.hora_salida_real is null
      and coalesce(r.tipo_registro, '') <> 'ausencia')                  as sin_fichar_salida,
  count(distinct r.turno_id) filter (where r.cierre_automatico)         as salida_automatica,
  count(distinct r.turno_id) filter (where r.hora_entrada_real is not null) as con_entrada_observada,
  count(distinct r.turno_id) filter (where r.alerta_entrada = 'tarde')  as tardanzas
from t
join usuarios u on u.id = t.guardia_id
left join r on r.turno_id = t.id
group by 1
order by 1;


-- ═══════════════════════════════════════════════════════════════════════
-- CONSULTA 2 de 3 — Rondas por empleado
--
-- Se excluyen las 190 alertas saneadas el 24/08: cerrarlas fue un acto
-- administrativo, no un incumplimiento del vigilador. Sin este filtro, todo
-- el mes de agosto castigaría a gente por algo que ya se dio por visto.
-- ═══════════════════════════════════════════════════════════════════════
select
  u.apellido || ', ' || u.nombre                                        as empleado,
  count(*)                                                              as alertas_total,
  count(*) filter (where a.tipo = 'no_iniciada')                        as no_iniciada,
  count(*) filter (where a.tipo = 'no_finalizada')                      as no_finalizada,
  count(*) filter (where a.tipo = 'suspendida')                         as suspendida,
  count(*) filter (
    where coalesce(a.comentario, '') like 'Saneamiento administrativo%') as saneadas_excluir
from ronda_alertas a
join usuarios u on u.id = a.guardia_id
where a.ventana_inicio >= '2026-08-01'
  and a.ventana_inicio <  '2026-09-01'
group by 1
order by 1;


-- ═══════════════════════════════════════════════════════════════════════
-- CONSULTA 3 de 3 — Evidencias IA revisadas por humano
--
-- Sólo informativa: Calidad arranca con peso 0. Sirve para ver si alcanza
-- la muestra mínima (15 revisiones) y para medir cuánto se equivocó la IA.
-- ═══════════════════════════════════════════════════════════════════════
select
  u.apellido || ', ' || u.nombre                                        as empleado,
  ea.analisis_tipo,
  count(*) filter (where ea.revision_estado = 'CORRECTO')               as confirmadas,
  count(*) filter (where ea.revision_estado = 'INCORRECTO')             as descartadas,
  count(*) filter (where ea.revision_estado = 'PENDIENTE')              as sin_revisar
from evidencia_analisis ea
join usuarios u on u.id = ea.guardia_id
where ea.evidencia_created_at >= '2026-08-01'
  and ea.evidencia_created_at <  '2026-09-01'
  and ea.clasificacion_efectiva = 'REVISAR'
group by 1, 2
order by 1, 2;
