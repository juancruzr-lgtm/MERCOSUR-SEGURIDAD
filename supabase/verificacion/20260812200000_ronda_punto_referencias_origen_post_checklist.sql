-- ═══════════════════════════════════════════════════════════════════════════
-- CHECKLIST POST — ORIGEN DE LAS REFERENCIAS DE PUNTO
--
-- Correr ENTERO después de aplicar 20260812200000_ronda_punto_referencias_origen.sql.
-- Sólo lectura: no escribe, no crea temporales. Todo tiene que dar PASS.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. La columna existe, es NOT NULL y su default es el valor conservador.
select 'C1 columna origen not null default manual' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'ronda_punto_referencias'
  and column_name = 'origen' and is_nullable = 'NO'
  and column_default like '%manual%';

-- 2. El CHECK acota el dominio a los dos valores.
select 'C2 check de dominio' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from pg_constraint
where conname = 'ronda_punto_referencias_origen_valido';

-- 3. Ninguna fila fuera del dominio.
select 'C3 sin valores invalidos' as control,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end as resultado
from public.ronda_punto_referencias
where origen not in ('manual', 'revision_humana');

-- 4. Ninguna referencia se perdió: el total tiene que ser el mismo de antes.
select 'C4 total de referencias (comparar con el valor previo)' as control,
       count(*)::text as resultado
from public.ronda_punto_referencias;

-- 5. Reparto del backfill. Lo esperable es que casi todo quede en 'manual':
--    sólo se reclasifica lo demostrable.
select 'C5 reparto por origen (informativo)' as control,
       origen || ' = ' || count(*)::text as resultado
from public.ronda_punto_referencias
group by origen;

-- 6. TODA referencia marcada 'revision_humana' tiene que ser demostrable:
--    sus bytes son copia de una evidencia de ese mismo punto confirmada por
--    una persona. Si esto falla, el backfill fue más permisivo de lo debido.
select 'C6 revision_humana demostrable' as control,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end as resultado
from public.ronda_punto_referencias r
where r.origen = 'revision_humana'
  and not exists (
        select 1
        from public.evidencia_analisis a
        join public.evidencias ev on ev.id = a.evidencia_id
        join public.ronda_ejecucion_puntos rep on rep.id = ev.proceso_id
        where a.analisis_tipo   = 'punto_control'
          and a.revision_estado = 'CORRECTO'
          and ev.contenido_sha256 = r.contenido_sha256
          and rep.ronda_punto_id  = r.ronda_punto_id
      );

-- 7. Invariante que ya existía y no se puede haber roto: como mucho UNA
--    referencia activa por punto.
select 'C7 una sola activa por punto' as control,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end as resultado
from (
  select ronda_punto_id
  from public.ronda_punto_referencias
  where activo
  group by ronda_punto_id
  having count(*) > 1
) duplicadas;

-- 8. Coherencia de vigencia: lo activo no puede tener fecha de cierre.
select 'C8 activa sin vigente_hasta' as control,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end as resultado
from public.ronda_punto_referencias
where activo and vigente_hasta is not null;

-- 9. Y lo cerrado sí tiene que tenerla. Filas históricas anteriores a esta
--    migración pueden no tenerla: se informa, no se exige.
select 'C9 historicas sin vigente_hasta (informativo)' as control,
       count(*)::text as resultado
from public.ronda_punto_referencias
where not activo and vigente_hasta is null;

-- 10. El índice existe.
select 'C10 indice por punto y origen' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from pg_indexes
where schemaname = 'public' and indexname = 'idx_ronda_punto_referencias_activa_origen';

-- 11. Cuántos puntos quedan protegidos y cuántos se van a auto-actualizar.
--     Es la foto de situación de la decisión que se acaba de tomar.
select 'C11 puntos con referencia activa por origen (informativo)' as control,
       origen || ' = ' || count(*)::text as resultado
from public.ronda_punto_referencias
where activo
group by origen;
