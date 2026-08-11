-- ═══════════════════════════════════════════════════════════════════════════
-- CHECKLIST POST — MEMORIA VISUAL POR PUNTO DE RONDA
--
-- Correr ENTERO después de aplicar 20260812100000_ia_memoria_visual_punto.sql.
-- Es de sólo lectura: no escribe, no crea temporales, no modifica nada.
-- Todo tiene que dar PASS.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. La columna existe y es nullable (uniforme y libro no tienen punto).
select 'C1 columna ronda_punto_id nullable' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'evidencia_analisis'
  and column_name = 'ronda_punto_id' and is_nullable = 'YES';

-- 2. Tiene FK a ronda_puntos con ON DELETE SET NULL: borrar un punto no puede
--    borrar el análisis ni su revisión humana.
select 'C2 FK con on delete set null' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from information_schema.referential_constraints rc
join information_schema.key_column_usage k
  on k.constraint_name = rc.constraint_name and k.constraint_schema = rc.constraint_schema
where k.table_name = 'evidencia_analisis' and k.column_name = 'ronda_punto_id'
  and rc.delete_rule = 'SET NULL';

-- 3. El índice parcial existe.
select 'C3 indice parcial por punto' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from pg_indexes
where schemaname = 'public' and indexname = 'idx_evidencia_analisis_punto_revision';

-- 4. El backfill no dejó análisis de ronda sin punto.
--    Si da FAIL, mirá el control 5 antes de preocuparte.
select 'C4 backfill sin huerfanos' as control,
       case when count(*) = 0 then 'PASS' else 'REVISAR: ' || count(*)::text end as resultado
from public.evidencia_analisis a
join public.evidencias ev on ev.id = a.evidencia_id
join public.ronda_ejecucion_puntos rep on rep.id = ev.proceso_id
where a.analisis_tipo = 'punto_control'
  and a.ronda_punto_id is null
  and rep.ronda_punto_id is not null;

-- 5. Análisis de ronda cuya ejecución ya no existe. Es un estado legítimo
--    (evidencias huérfanas del 28-29/07); quedan en NULL y no se usan.
select 'C5 evidencias huerfanas conocidas (informativo)' as control,
       count(*)::text as resultado
from public.evidencia_analisis a
join public.evidencias ev on ev.id = a.evidencia_id
left join public.ronda_ejecucion_puntos rep on rep.id = ev.proceso_id
where a.analisis_tipo = 'punto_control' and rep.id is null;

-- 6. Ningún análisis de uniforme o libro quedó atado a un punto.
select 'C6 sin contaminacion de tipos' as control,
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || count(*)::text end as resultado
from public.evidencia_analisis
where analisis_tipo in ('uniforme', 'libro_guardia') and ronda_punto_id is not null;

-- 7. Las cuatro claves de configuración están.
select 'C7 claves de configuracion' as control,
       case when count(*) = 4 then 'PASS' else 'FAIL: ' || count(*)::text end as resultado
from public.app_config
where key in ('ia_memoria_max_positivos', 'ia_memoria_max_negativos',
              'ia_memoria_minimo_historial', 'ia_ronda_solo_gps_fuera_radio');

-- 8. El kill-switch quedó en false: GPS y foto son controles independientes.
--    Con la clave ausente el cron la leía como true y analizaba SÓLO las fotos
--    fuera de radio, sesgando el historial hacia los casos anómalos.
select 'C8 solo_gps_fuera_radio = false' as control,
       case when value = 'false' then 'PASS' else 'FAIL: ' || coalesce(value, 'null') end as resultado
from public.app_config where key = 'ia_ronda_solo_gps_fuera_radio';

-- 9. La vista existe y se puede consultar.
select 'C9 vista ia_metricas_punto' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from pg_views where schemaname = 'public' and viewname = 'ia_metricas_punto';

-- 10. La vista respeta el RLS de quien consulta. Sin esto, un supervisor de una
--     zona vería métricas de puntos de otra.
select 'C10 vista con security_invoker' as control,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as resultado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'ia_metricas_punto'
  and c.reloptions::text like '%security_invoker=on%';

-- 11. La vista devuelve una fila por punto y ninguna duplicada.
select 'C11 una fila por punto' as control,
       case when count(*) = count(distinct ronda_punto_id) then 'PASS' else 'FAIL' end as resultado
from public.ia_metricas_punto;

-- 12. Coherencia: los ejemplos positivos de la vista coinciden con las
--     revisiones humanas reales. Si difieren, la vista miente.
select 'C12 ejemplos = revisiones CORRECTO' as control,
       case when coalesce(sum(v.ejemplos_positivos), 0) = (
              select count(*) from public.evidencia_analisis
              where ronda_punto_id is not null
                and estado = 'completado'
                and revision_estado = 'CORRECTO')
            then 'PASS' else 'FAIL' end as resultado
from public.ia_metricas_punto v;

-- 13. Ninguna revisión humana se perdió con la migración.
select 'C13 revisiones humanas intactas' as control,
       count(*)::text || ' revisiones registradas' as resultado
from public.evidencia_analisis_revisiones;

-- 14. Foto de situación: cuántos puntos ya tienen con qué comparar.
select 'C14 puntos con base de comparacion (informativo)' as control,
       count(*) filter (where ejemplos_positivos > 0 or referencias_formales > 0)::text
         || ' de ' || count(*)::text as resultado
from public.ia_metricas_punto;
