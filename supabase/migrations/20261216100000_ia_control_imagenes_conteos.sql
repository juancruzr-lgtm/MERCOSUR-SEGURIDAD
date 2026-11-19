-- ============================================================================
-- Panel "Control de imágenes IA" (Dashboard): un solo conteo liviano
-- (incidente 18/11/2026 22:00 — la base se quedó sin Disk IO y nadie entraba)
-- ============================================================================
-- ANTES: el panel hacía 9 conteos en paralelo (count exact, head) sobre TODO
-- evidencia_analisis. Cada uno pasaba por la RLS "IA analisis lectura por
-- alcance" = puede_administrar_rondas_objetivo(objetivo_id) FILA POR FILA:
-- 13.891 filas x 9 conteos = ~125.000 evaluaciones por cada apertura del
-- Dashboard. En NANO tardaban 1,4–8,8 s cada uno (11 ms sin RLS).
--
-- AHORA: una función que recorre la tabla UNA vez, agrupa por objetivo y
-- aplica el mismo permiso UNA vez por objetivo (hoy 49). Devuelve los mismos 9
-- números con la misma semántica que los filtros de PostgREST del panel
-- (neq/eq de SQL: los NULL no cuentan en ningún lado).
--
-- Alcance: idéntico a la RLS de la tabla (las dos políticas):
--   * acceso_habilitado_actual()        (política acceso_bloqueado_baja)
--   * puede_administrar_rondas_objetivo (política de lectura por alcance)
-- SECURITY DEFINER sólo para no evaluar la RLS fila por fila; el filtro de
-- alcance se aplica explícito acá adentro. auth.uid() sigue siendo el de quien
-- llama (lo lee del JWT de la request).
--
-- Rollback: supabase/rollback/20261216100000_ia_control_imagenes_conteos_rollback.sql
-- ============================================================================

begin;

create or replace function public.ia_control_imagenes_conteos()
returns table (
  analizadas          bigint,
  ok                  bigint,
  dudosas             bigint,
  a_revision          bigint,
  confirmadas         bigint,
  descartadas         bigint,
  observ_revisadas    bigint,
  observ_descartadas  bigint,
  revisadas           bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  -- MATERIALIZED es imprescindible: sin él Postgres empuja el filtro de
  -- permiso (sobre la columna de agrupación) por debajo del GROUP BY y lo
  -- vuelve a evaluar fila por fila (medido: 3.576 ms vs 27 ms).
  with por_objetivo as materialized (
    select
      a.objetivo_id,
      count(*) as analizadas,
      count(*) filter (where a.clasificacion_efectiva = 'SIN_OBSERVACIONES') as ok,
      count(*) filter (where a.clasificacion_efectiva = 'EVIDENCIA_INSUFICIENTE') as dudosas,
      count(*) filter (where a.clasificacion_efectiva <> 'SIN_OBSERVACIONES'
                          or a.en_muestra_control is true) as a_revision,
      count(*) filter (where a.revision_estado = 'INCORRECTO') as confirmadas,
      count(*) filter (where a.revision_estado = 'CORRECTO') as descartadas,
      count(*) filter (where a.clasificacion_efectiva <> 'SIN_OBSERVACIONES'
                         and a.revision_estado <> 'PENDIENTE') as observ_revisadas,
      count(*) filter (where a.clasificacion_efectiva <> 'SIN_OBSERVACIONES'
                         and a.revision_estado = 'CORRECTO') as observ_descartadas,
      count(*) filter (where a.revision_estado <> 'PENDIENTE') as revisadas
    from public.evidencia_analisis a
    where a.estado = 'completado'
    group by a.objetivo_id
  )
  select
    coalesce(sum(p.analizadas), 0)::bigint,
    coalesce(sum(p.ok), 0)::bigint,
    coalesce(sum(p.dudosas), 0)::bigint,
    coalesce(sum(p.a_revision), 0)::bigint,
    coalesce(sum(p.confirmadas), 0)::bigint,
    coalesce(sum(p.descartadas), 0)::bigint,
    coalesce(sum(p.observ_revisadas), 0)::bigint,
    coalesce(sum(p.observ_descartadas), 0)::bigint,
    coalesce(sum(p.revisadas), 0)::bigint
  from por_objetivo p
  where (select public.acceso_habilitado_actual())
    and public.puede_administrar_rondas_objetivo(p.objetivo_id);
$fn$;

comment on function public.ia_control_imagenes_conteos() is
  'Panel Control de imágenes IA: los 9 conteos en una pasada; permiso por objetivo (no por fila). Incidente Disk IO 18/11/2026.';

revoke all on function public.ia_control_imagenes_conteos() from public, anon;
grant execute on function public.ia_control_imagenes_conteos() to authenticated;

commit;
