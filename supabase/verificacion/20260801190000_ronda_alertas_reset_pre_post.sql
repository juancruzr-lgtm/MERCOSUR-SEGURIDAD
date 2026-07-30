-- ============================================================================
-- VERIFICACIÓN de 20260801190000_ronda_alertas_reset_implementacion
-- ============================================================================
-- Bloques 1-4: ANTES de aplicar.  Bloques 5-9: DESPUÉS.
-- Bloque 10: a correr tras la PRIMERA pasada del cron posterior al reset.
--
-- Correr como `postgres` en el SQL Editor. Ningún bloque de este archivo escribe.

-- ════════════════════════════ PRE ═══════════════════════════════════════════

-- ── 1. PRE — Lo que se va a borrar ──────────────────────────────────────────
-- Esperado: alertas = 84. Si difiere, el conjunto cambió desde el diagnóstico:
-- revisar antes de seguir (el cron pudo haber corrido).
select
  (select count(*) from public.ronda_alertas)               as alertas,
  (select count(*) from public.ronda_alerta_intervenciones) as intervenciones_que_arrastra_el_cascade;

-- ── 2. PRE — Línea base de lo que NO se debe tocar ──────────────────────────
-- Anotar estos números. El bloque 7 los compara uno por uno.
select
  (select count(*) from public.ronda_ejecuciones)       as ejecuciones,
  (select count(*) from public.ronda_ejecucion_puntos)  as ejecucion_puntos,
  (select count(*) from public.rondas_base)             as rondas_base,
  (select count(*) from public.ronda_puntos)            as puntos,
  (select count(*) from public.evidencias)              as evidencias,
  (select count(*) from public.turnos)                  as turnos,
  (select count(*) from public.registros_asistencia)    as registros_asistencia;

-- ── 3. PRE — Composición del conjunto que se descarta ───────────────────────
-- Deja constancia de qué se borró, por si mañana hay que justificarlo.
select tipo, estado, count(*) as filas,
       min(detectada_at) as primera, max(detectada_at) as ultima
from public.ronda_alertas
group by tipo, estado
order by tipo, estado;

-- ── 4. PRE — El caso La Casona ──────────────────────────────────────────────
-- Rondas que SÍ se ejecutaron y aun así tienen una `no_iniciada` en la misma
-- ventana. Es la evidencia de que el conjunto no es confiable, y la razón por
-- la que se descarta entero en vez de depurarlo.
--
-- No hace falta que devuelva filas para seguir: es documentación del motivo.
select
  ob.nombre                     as objetivo,
  rb.nombre                     as ronda,
  a.ventana_inicio,
  a.tipo                        as alerta,
  a.estado                      as alerta_estado,
  e.id                          as ejecucion_id,
  e.iniciada_at,
  e.estado                      as ejecucion_estado,
  e.resultado
from public.ronda_alertas a
join public.objetivos   ob on ob.id = a.objetivo_id
join public.rondas_base rb on rb.id = a.ronda_base_id
join public.ronda_ejecuciones e
  on  e.ronda_base_id = a.ronda_base_id
  and e.turno_id      = a.turno_id
  and e.estado in ('en_curso', 'finalizada')
where a.tipo = 'no_iniciada'
order by ob.nombre, a.ventana_inicio desc;

-- ════════════════════════════ POST ══════════════════════════════════════════

-- ── 5. POST — Las tablas vivas quedaron vacías ──────────────────────────────
-- Esperado: 0 y 0.
select
  (select count(*) from public.ronda_alertas)               as alertas,
  (select count(*) from public.ronda_alerta_intervenciones) as intervenciones;

-- ── 6. POST — Nada se perdió: el archivo tiene todo ─────────────────────────
-- Esperado: alertas_archivadas = 84 (el valor del bloque 1) e
-- intervenciones_archivadas = el valor del bloque 1.
select
  (select count(*) from public.ronda_alertas_archivo_20260801)               as alertas_archivadas,
  (select count(*) from public.ronda_alerta_intervenciones_archivo_20260801) as intervenciones_archivadas;

-- ── 7. POST — Lo que no se debía tocar sigue igual ──────────────────────────
-- Comparar contra el bloque 2. Los siete números tienen que ser IDÉNTICOS.
select
  (select count(*) from public.ronda_ejecuciones)       as ejecuciones,
  (select count(*) from public.ronda_ejecucion_puntos)  as ejecucion_puntos,
  (select count(*) from public.rondas_base)             as rondas_base,
  (select count(*) from public.ronda_puntos)            as puntos,
  (select count(*) from public.evidencias)              as evidencias,
  (select count(*) from public.turnos)                  as turnos,
  (select count(*) from public.registros_asistencia)    as registros_asistencia;

-- ── 8. POST — Ningún punto de ejecución quedó huérfano ──────────────────────
-- El borrado no debe haber tocado la cadena ejecución → puntos → evidencia.
-- Esperado: 0 filas en las tres columnas.
select
  (select count(*) from public.ronda_ejecucion_puntos ep
     where not exists (select 1 from public.ronda_ejecuciones e where e.id = ep.ronda_ejecucion_id))
                                                        as puntos_sin_ejecucion,
  (select count(*) from public.ronda_ejecuciones e
     where not exists (select 1 from public.rondas_base rb where rb.id = e.ronda_base_id))
                                                        as ejecuciones_sin_ronda,
  (select count(*) from public.ronda_ejecuciones e where e.estado = 'finalizada'
     and not exists (select 1 from public.ronda_ejecucion_puntos ep where ep.ronda_ejecucion_id = e.id))
                                                        as finalizadas_sin_puntos;

-- ── 9. POST — El archivo no quedó expuesto en la API ────────────────────────
-- Esperado: las dos columnas en false. Si alguna diera true, la tabla de
-- respaldo sería legible desde el cliente vía PostgREST.
select
  has_table_privilege('authenticated', 'public.ronda_alertas_archivo_20260801', 'select')               as lee_authenticated,
  has_table_privilege('anon',          'public.ronda_alertas_archivo_20260801', 'select')               as lee_anon;

-- ════════════ 10. DESPUÉS DE LA PRIMERA CORRIDA DEL CRON ════════════════════

-- ── 10. La medición nueva, ¿es confiable? ───────────────────────────────────
-- Requiere las correctivas 20260801130000-170000 aplicadas.
--
-- El reset borra el síntoma, no la causa. Si en La Casona había `no_iniciada`
-- sobre rondas realizadas, hay un desajuste entre la ejecución y la ventana que
-- se le atribuye, y va a volver a producirse sobre los datos nuevos.
--
-- Esta consulta lista las ejecuciones que NO caen en ninguna ventana programada
-- de su propio turno y ronda. Cada fila es una ronda que el vigilador hizo y que
-- el evaluador no le va a reconocer a ninguna ventana.
--
-- Esperado: 0 filas. Si aparecen filas, NO tomar la medición nueva como buena y
-- revisar primero `rondas_base.hora_inicio` e `intervalo_minutos` del puesto, y
-- el `turno_id` con el que se creó la ejecución.
select
  ob.nombre        as objetivo,
  rb.nombre        as ronda,
  rb.hora_inicio   as ronda_hora_inicio,
  rb.intervalo_minutos,
  e.id             as ejecucion_id,
  e.turno_id,
  e.iniciada_at,
  e.estado,
  e.resultado
from public.ronda_ejecuciones e
join public.objetivos   ob on ob.id = e.objetivo_id
join public.rondas_base rb on rb.id = e.ronda_base_id
where e.estado in ('en_curso', 'finalizada')
  and e.iniciada_at >= now() - interval '7 days'
  and not exists (
    select 1
    from public.rondas_ventanas_programadas(
           e.objetivo_id,
           (e.iniciada_at at time zone 'America/Argentina/Buenos_Aires')::date - 1,
           (e.iniciada_at at time zone 'America/Argentina/Buenos_Aires')::date + 1
         ) v
    where v.ronda_base_id = e.ronda_base_id
      and v.turno_id      = e.turno_id
      and e.iniciada_at  >= v.ventana_inicio
      and e.iniciada_at  <  v.match_fin
  )
order by e.iniciada_at desc;
