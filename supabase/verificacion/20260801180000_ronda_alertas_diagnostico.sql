-- ============================================================================
-- DIAGNÓSTICO de alertas de rondas — PASO PREVIO a cualquier limpieza
-- ============================================================================
--
-- ESTE ARCHIVO NO ESCRIBE NADA. Son diez consultas de lectura. No hay DELETE,
-- UPDATE, INSERT ni DDL, ni acá ni en ningún archivo asociado: la migración de
-- limpieza NO se escribe hasta que estos resultados estén revisados y aprobados.
--
-- Objetivo: pasar de "Alertas tiene información vieja de desarrollo" a un
-- criterio de borrado escrito, defendible y acotado. Cada bloque responde una
-- pregunta concreta; el bloque 10 cuantifica qué tocaría cada criterio candidato
-- ANTES de decidir.
--
-- Correr como `postgres` en el SQL Editor. Con sesión de supervisor, RLS
-- recortaría los resultados y el diagnóstico saldría incompleto.
--
-- IMPORTANTE sobre el orden de ejecución: conviene correrlo ANTES de aplicar
-- 20260801140000 (correctivo del evaluador). Después de ese correctivo el
-- evaluador deja de generar alertas nuevas de objetivos de prueba y de rondas
-- suspendidas, pero las YA CREADAS siguen ahí: son exactamente las que estas
-- consultas cuantifican.

-- ── 1. Inventario general ────────────────────────────────────────────────────
-- Foto de tamaño del problema. Si `pendientes` es alto y `resueltas` casi cero,
-- la bandeja nunca se usó como bandeja de trabajo.
select
  count(*)                                            as total,
  count(*) filter (where estado = 'pendiente')        as pendientes,
  count(*) filter (where estado = 'resuelta')         as resueltas,
  count(*) filter (where tipo   = 'no_iniciada')      as no_iniciada,
  count(*) filter (where tipo   = 'no_finalizada')    as no_finalizada,
  count(*) filter (where tipo   = 'suspendida')       as suspendida,
  min(detectada_at)                                   as primera,
  max(detectada_at)                                   as ultima
from public.ronda_alertas;

-- ── 2. ¿El cron está vivo? ───────────────────────────────────────────────────
-- `vercel.json` no declara `crons`: el evaluador lo dispara un scheduler externo
-- con CRON_SECRET. Si la última detección es de hace días, NO se están generando
-- alertas y cualquier conclusión sobre los datos actuales es engañosa.
--
-- Esperado con el cron sano: horas_desde_ultima_deteccion < 1.
select
  max(detectada_at)                                                as ultima_deteccion,
  round(extract(epoch from (now() - max(detectada_at))) / 3600, 1) as horas_desde_ultima_deteccion,
  count(*) filter (where detectada_at > now() - interval '24 hours') as detectadas_ultimas_24h
from public.ronda_alertas;

-- ── 3. Alertas de objetivos de PRUEBA ────────────────────────────────────────
-- Causa 4.a de la auditoría. Son el candidato principal de la limpieza: datos
-- que nunca debieron existir, no información operativa perdida.
select
  ob.id                                        as objetivo_id,
  ob.nombre                                    as objetivo,
  ob.es_prueba,
  ob.estado                                    as objetivo_estado,
  count(*)                                     as alertas,
  count(*) filter (where a.estado = 'pendiente') as pendientes,
  min(a.detectada_at)                          as primera,
  max(a.detectada_at)                          as ultima
from public.ronda_alertas a
join public.objetivos ob on ob.id = a.objetivo_id
group by ob.id, ob.nombre, ob.es_prueba, ob.estado
order by ob.es_prueba desc, pendientes desc;

-- ── 4. Antigüedad de las pendientes ──────────────────────────────────────────
-- Una alerta pendiente de hace semanas ya no es trabajo: nadie la va a atender.
-- Sirve para decidir si hay una fecha de corte razonable además de es_prueba.
select
  date_trunc('month', a.detectada_at)::date      as mes,
  count(*)                                       as pendientes,
  count(*) filter (where ob.es_prueba)           as de_objetivos_prueba,
  count(*) filter (where not ob.es_prueba)       as de_objetivos_reales
from public.ronda_alertas a
join public.objetivos ob on ob.id = a.objetivo_id
where a.estado = 'pendiente'
group by 1
order by 1;

-- ── 5. Víctimas del defecto de cierre administrativo ─────────────────────────
-- Causa 4.c. Alertas que el supervisor cerró creyendo que quedaban resueltas:
-- la ejecución fue cerrada administrativamente pero la alerta siguió pendiente
-- porque no era de tipo `no_finalizada`.
--
-- Estas NO se borran: las corrige 20260801150000 y se resuelven trabajándolas
-- desde la aplicación. Se listan para saber cuántas son y avisar al supervisor.
select
  a.id            as alerta_id,
  a.tipo,
  ob.nombre       as objetivo,
  rb.nombre       as ronda,
  a.ventana_inicio,
  e.cerrada_at,
  e.cerrada_motivo,
  u.apellido || ', ' || u.nombre as cerrada_por
from public.ronda_alertas a
join public.ronda_ejecuciones e on e.id = a.ejecucion_id
join public.objetivos   ob on ob.id = a.objetivo_id
join public.rondas_base rb on rb.id = a.ronda_base_id
left join public.usuarios u on u.id = e.cerrada_por
where a.estado = 'pendiente'
  and e.cerrada_por is not null
order by e.cerrada_at desc;

-- ── 6. Ruido por rondas suspendidas ──────────────────────────────────────────
-- Causa 4.b. Cada fila es una `no_iniciada` que no debió emitirse porque el
-- vigilador ya había declarado la suspensión de esa ronda en ese turno.
--
-- 20260801140000 impide que se sigan generando. Este conteo dice cuántas quedaron.
select
  ob.nombre                    as objetivo,
  rb.nombre                    as ronda,
  a.turno_id,
  count(*)                     as no_iniciada_redundantes,
  min(a.ventana_inicio)        as desde,
  max(a.ventana_inicio)        as hasta,
  max(s.motivo_vigilador)      as motivo_declarado
from public.ronda_alertas a
join public.ronda_alertas s
  on  s.ronda_base_id = a.ronda_base_id
  and s.turno_id      = a.turno_id
  and s.tipo          = 'suspendida'
join public.objetivos   ob on ob.id = a.objetivo_id
join public.rondas_base rb on rb.id = a.ronda_base_id
where a.tipo   = 'no_iniciada'
  and a.estado = 'pendiente'
group by ob.nombre, rb.nombre, a.turno_id
order by no_iniciada_redundantes desc;

-- ── 7. Alertas sobre configuración que ya no existe ──────────────────────────
-- Rondas desactivadas u objetivos inactivos: la obligación ya no rige, la alerta
-- quedó colgada. Candidato secundario de limpieza.
select
  count(*) filter (where not rb.activo)          as de_rondas_desactivadas,
  count(*) filter (where ob.estado <> 'activo')  as de_objetivos_inactivos,
  count(*)                                       as pendientes_totales
from public.ronda_alertas a
join public.rondas_base rb on rb.id = a.ronda_base_id
join public.objetivos   ob on ob.id = a.objetivo_id
where a.estado = 'pendiente';

-- ── 8. Concentración por objetivo real ───────────────────────────────────────
-- Si un solo objetivo real concentra casi todo, probablemente sea configuración
-- mal cargada (intervalo demasiado corto) y no incumplimiento del vigilador.
-- Eso se arregla en Configuración, NO borrando alertas.
select
  ob.nombre                       as objetivo,
  rb.nombre                       as ronda,
  rb.intervalo_minutos,
  rb.activo                       as ronda_activa,
  count(*)                        as pendientes
from public.ronda_alertas a
join public.objetivos   ob on ob.id = a.objetivo_id
join public.rondas_base rb on rb.id = a.ronda_base_id
where a.estado = 'pendiente'
  and ob.es_prueba = false
group by ob.nombre, rb.nombre, rb.intervalo_minutos, rb.activo
order by pendientes desc
limit 30;

-- ── 9. Historial de intervenciones ───────────────────────────────────────────
-- ¿La bandeja se usó alguna vez? Si no hay intervenciones, borrar lo viejo no
-- destruye trabajo de nadie.
select
  count(*)                                   as intervenciones,
  count(distinct ronda_alerta_id)            as alertas_intervenidas,
  count(distinct supervisor_id)              as supervisores_que_intervinieron,
  min(created_at)                            as primera,
  max(created_at)                            as ultima
from public.ronda_alerta_intervenciones;

-- ── 10. Simulación de criterios de borrado — CUENTA, NO BORRA ────────────────
-- Cuántas filas tocaría cada criterio candidato, y cuántas de ellas tienen
-- intervenciones registradas (si alguna las tiene, el criterio está mal: borrar
-- destruiría trazabilidad de trabajo real).
--
-- REGLA: ningún criterio es aceptable si `con_intervenciones` > 0.
-- Ninguno de estos criterios se ejecuta. La migración de limpieza se escribe
-- recién con estos números aprobados.
with candidatos as (
  select a.id,
         'A · objetivos es_prueba'::text as criterio
    from public.ronda_alertas a
    join public.objetivos ob on ob.id = a.objetivo_id
   where ob.es_prueba
  union all
  select a.id, 'B · rondas desactivadas'
    from public.ronda_alertas a
    join public.rondas_base rb on rb.id = a.ronda_base_id
   where not rb.activo
  union all
  select a.id, 'C · pendientes anteriores al 2026-07-01'
    from public.ronda_alertas a
   where a.estado = 'pendiente'
     and a.detectada_at < timestamptz '2026-07-01 00:00-03'
  union all
  select a.id, 'D · no_iniciada redundante por suspensión'
    from public.ronda_alertas a
   where a.tipo = 'no_iniciada'
     and exists (
       select 1 from public.ronda_alertas s
        where s.ronda_base_id = a.ronda_base_id
          and s.turno_id      = a.turno_id
          and s.tipo          = 'suspendida'
     )
)
select
  c.criterio,
  count(distinct c.id)                                          as alertas_afectadas,
  count(distinct c.id) filter (where iv.ronda_alerta_id is not null)
                                                                as con_intervenciones
from candidatos c
left join public.ronda_alerta_intervenciones iv on iv.ronda_alerta_id = c.id
group by c.criterio
order by c.criterio;
