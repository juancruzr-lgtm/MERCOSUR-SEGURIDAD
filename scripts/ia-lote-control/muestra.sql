-- Lote de control de la IA: muestra de 30 libros de guardia + 30 puntos de ronda.
-- SÓLO LECTURA. Pegar en el editor de Supabase y guardar el resultado (una
-- columna `muestra` con un JSON) como archivo FUERA del repositorio; ese
-- archivo es la entrada de ejecutar.lote.test.ts.
--
-- Criterio: análisis completados de los últimos 60 días, con integridad no
-- divergente; ~1 de cada 4 con resultado distinto de SIN_OBSERVACIONES (para
-- ver si la compresión mueve justo los casos dudosos); repartidos entre
-- objetivos (máx. 3 por objetivo en libros, 6 en rondas) y al azar dentro de cada grupo.

with base as (
  select a.id, a.analisis_tipo, a.objetivo_id,
         (a.clasificacion_efectiva <> 'SIN_OBSERVACIONES') as no_ok,
         row_number() over (partition by a.analisis_tipo, a.objetivo_id order by random()) as por_objetivo
  from public.evidencia_analisis a
  where a.estado = 'completado'
    and a.analisis_tipo in ('libro_guardia', 'punto_control')
    and a.analizado_at > now() - interval '60 days'
    and coalesce(a.integridad, 'sin_hash') <> 'divergente'
),
elegidos as (
  select b.*, row_number() over (partition by b.analisis_tipo, b.no_ok order by random()) as orden
  from base b
  -- Las rondas están en pocos objetivos: se permiten más por objetivo.
  where b.por_objetivo <= case b.analisis_tipo when 'punto_control' then 6 else 3 end
)
select jsonb_build_object(
  'generada_at', now(),
  'analisis', jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.analisis_tipo, 'no_ok', e.no_ok))
) as muestra
from elegidos e
where (e.no_ok and e.orden <= 8) or (not e.no_ok and e.orden <= 22);
