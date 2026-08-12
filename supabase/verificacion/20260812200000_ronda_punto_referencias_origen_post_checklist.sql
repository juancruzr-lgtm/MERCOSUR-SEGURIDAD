-- ============================================================================
-- POST · Checklist automático — 20260812200000_ronda_punto_referencias_origen
-- ============================================================================
--
-- Ejecutar COMPLETO después de aplicar la migración.
-- Devuelve una fila por control con PASS / FAIL. Si hay un solo FAIL,
-- DETENERSE y reportar antes de seguir.
--
-- Todo es SELECT. No modifica nada.
--
-- UNA sola sentencia a propósito: el editor SQL de Supabase muestra únicamente
-- el resultado de la última sentencia de un script, así que un checklist
-- escrito como N selects sueltos deja ver un solo control y oculta los otros.
-- ============================================================================

select '01 columna origen not null default manual' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'ronda_punto_referencias'
  and column_name = 'origen' and is_nullable = 'NO'
  and column_default like '%manual%'

union all
select '02 check de dominio',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from pg_constraint where conname = 'ronda_punto_referencias_origen_valido'

union all
select '03 sin valores invalidos',
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end
from public.ronda_punto_referencias
where origen not in ('manual', 'revision_humana')

union all
select '04 total de referencias (informativo)', count(*)::text
from public.ronda_punto_referencias

union all
select '05 reparto por origen (informativo)', origen || ' = ' || count(*)::text
from public.ronda_punto_referencias group by origen

-- TODA referencia marcada 'revision_humana' tiene que ser demostrable: sus
-- bytes son copia de una evidencia de ese mismo punto confirmada por una
-- persona. Si esto falla, el backfill fue más permisivo de lo debido y hay
-- referencias que la automatización podría reemplazar sin derecho.
union all
select '06 revision_humana demostrable',
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end
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
          and rep.ronda_punto_id  = r.ronda_punto_id)

-- Invariante que ya existía y esta migración no puede haber roto.
union all
select '07 una sola activa por punto',
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end
from (select ronda_punto_id from public.ronda_punto_referencias
      where activo group by ronda_punto_id having count(*) > 1) dup

union all
select '08 activa sin vigente_hasta',
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end
from public.ronda_punto_referencias where activo and vigente_hasta is not null

-- Las históricas anteriores a esta migración pueden no tener fecha de cierre:
-- se informa, no se exige.
union all
select '09 historicas sin vigente_hasta (informativo)', count(*)::text
from public.ronda_punto_referencias where not activo and vigente_hasta is null

union all
select '10 indice por punto y origen',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from pg_indexes
where schemaname = 'public' and indexname = 'idx_ronda_punto_referencias_activa_origen'

-- Foto de situación: cuántos puntos quedan protegidos y cuántos se van a
-- actualizar solos con la próxima confirmación.
union all
select '11 activas por origen (informativo)', origen || ' = ' || count(*)::text
from public.ronda_punto_referencias where activo group by origen

order by 1;
