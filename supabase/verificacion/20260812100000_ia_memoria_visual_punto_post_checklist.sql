-- ============================================================================
-- POST · Checklist automático — 20260812100000_ia_memoria_visual_punto
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

select '01 columna ronda_punto_id nullable' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'evidencia_analisis'
  and column_name = 'ronda_punto_id' and is_nullable = 'YES'

-- Borrar un punto no puede borrar el análisis ni la revisión humana que lo acompaña.
union all
select '02 FK con on delete set null',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from information_schema.referential_constraints rc
join information_schema.key_column_usage k
  on k.constraint_name = rc.constraint_name and k.constraint_schema = rc.constraint_schema
where k.table_name = 'evidencia_analisis' and k.column_name = 'ronda_punto_id'
  and rc.delete_rule = 'SET NULL'

union all
select '03 indice parcial por punto',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from pg_indexes
where schemaname = 'public' and indexname = 'idx_evidencia_analisis_punto_revision'

-- Si da distinto de cero, mirá el control 05 antes de preocuparte.
union all
select '04 backfill sin huerfanos',
       case when count(*) = 0 then 'PASS' else 'REVISAR: ' || count(*)::text end
from public.evidencia_analisis a
join public.evidencias ev on ev.id = a.evidencia_id
join public.ronda_ejecucion_puntos rep on rep.id = ev.proceso_id
where a.analisis_tipo = 'punto_control'
  and a.ronda_punto_id is null
  and rep.ronda_punto_id is not null

-- Estado legítimo: las evidencias huérfanas del 28-29/07. Quedan en NULL y no
-- se usan como memoria visual.
union all
select '05 evidencias huerfanas conocidas (informativo)', count(*)::text
from public.evidencia_analisis a
join public.evidencias ev on ev.id = a.evidencia_id
left join public.ronda_ejecucion_puntos rep on rep.id = ev.proceso_id
where a.analisis_tipo = 'punto_control' and rep.id is null

union all
select '06 sin contaminacion de tipos',
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end
from public.evidencia_analisis
where analisis_tipo in ('uniforme', 'libro_guardia') and ronda_punto_id is not null

union all
select '07 claves de configuracion',
       case when count(*) = 4 then 'PASS' else 'FAIL: ' || count(*)::text end
from public.app_config
where key in ('ia_memoria_max_positivos', 'ia_memoria_max_negativos',
              'ia_memoria_minimo_historial', 'ia_ronda_solo_gps_fuera_radio')

-- Con la clave ausente el cron la leía como true y analizaba SÓLO las fotos con
-- GPS fuera de radio, sesgando el historial hacia los casos anómalos.
union all
select '08 solo_gps_fuera_radio = false',
       case when value = 'false' then 'PASS' else 'FAIL: ' || coalesce(value, 'null') end
from public.app_config where key = 'ia_ronda_solo_gps_fuera_radio'

-- Sin punto_control acá, el cron nunca analiza una foto de ronda.
union all
select '09 punto_control habilitado en el cron',
       case when value like '%punto_control%' then 'PASS' else 'FAIL: ' || coalesce(value, 'null') end
from public.app_config where key = 'ia_tipos_activos'

union all
select '10 vista ia_metricas_punto',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from pg_views where schemaname = 'public' and viewname = 'ia_metricas_punto'

-- Sin security_invoker, un supervisor de una zona vería métricas de otra.
union all
select '11 vista con security_invoker',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'ia_metricas_punto'
  and c.reloptions::text like '%security_invoker=on%'

union all
select '12 una fila por punto',
       case when count(*) = count(distinct ronda_punto_id) then 'PASS' else 'FAIL' end
from public.ia_metricas_punto

-- Si los ejemplos de la vista no coinciden con las revisiones reales, la vista miente.
union all
select '13 ejemplos = revisiones CORRECTO',
       case when coalesce(sum(v.ejemplos_positivos), 0) = (
              select count(*) from public.evidencia_analisis
              where ronda_punto_id is not null
                and estado = 'completado'
                and revision_estado = 'CORRECTO')
            then 'PASS' else 'FAIL' end
from public.ia_metricas_punto v

union all
select '14 revisiones humanas intactas', count(*)::text || ' registradas'
from public.evidencia_analisis_revisiones

union all
select '15 puntos con base de comparacion (informativo)',
       count(*) filter (where ejemplos_positivos > 0 or referencias_formales > 0)::text
         || ' de ' || count(*)::text
from public.ia_metricas_punto

order by 1;
