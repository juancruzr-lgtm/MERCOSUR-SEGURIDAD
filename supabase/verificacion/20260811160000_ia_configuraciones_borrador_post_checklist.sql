-- ============================================================================
-- POST · Checklist — 20260811160000_ia_configuraciones_borrador
-- ============================================================================
--
-- UNA sola sentencia. Cero escrituras. Cero temp tables. Cero DO blocks.
-- Devuelve una grilla con PASS / *** FAIL *** por control.
--
-- Correr DESPUÉS de aplicar la migración. Si el control 2 da FAIL, la migración
-- no está aplicada y el resto del checklist no significa nada todavía.
--
-- POR QUÉ NO SE PRUEBA CON UN INSERT
-- El CHECK `ia_configuraciones_modelo_no_vacio` es `length(btrim(modelo)) > 0`:
-- una expresión pura. Se puede evaluar con los mismos valores que usaría la
-- base, sin tocar la tabla. Probarlo con un INSERT era peor por tres motivos:
-- escribía en producción, dependía del orden en que PostgreSQL evalúa NOT NULL
-- antes que CHECK, y necesitaba un lugar donde juntar resultados.
-- ============================================================================

with c as (

  -- ── 2 · ¿La migración está aplicada? ──────────────────────────────────────
  select 2 as nro, 'modelo y prompt son nullable (migración aplicada)' as control,
    '2' as esperado,
    (select count(*)::text from information_schema.columns
      where table_schema='public' and table_name='ia_configuraciones'
        and column_name in ('modelo','prompt') and is_nullable='YES') as obtenido

  -- ── 3 · El CHECK sigue instalado y validado ───────────────────────────────
  union all select 3, 'CHECK ia_configuraciones_modelo_no_vacio presente y validado', 'true',
    coalesce((select convalidated::text from pg_constraint
               where conrelid='public.ia_configuraciones'::regclass
                 and conname='ia_configuraciones_modelo_no_vacio'), 'NO EXISTE')

  union all select 4, 'Definición del CHECK sin cambios', 'ok',
    coalesce((select case when pg_get_constraintdef(oid) ilike '%btrim(modelo)%' then 'ok'
                          else 'DISTINTO: ' || pg_get_constraintdef(oid) end
                from pg_constraint
               where conrelid='public.ia_configuraciones'::regclass
                 and conname='ia_configuraciones_modelo_no_vacio'), 'NO EXISTE')

  -- ── 5-8 · Comportamiento del CHECK, evaluado sobre la expresión real ──────
  -- Un CHECK sólo rechaza cuando la expresión da FALSE. NULL la deja pasar.
  union all select 5, 'modelo = ''''  →  rechazado', 'false',
    (length(btrim('')) > 0)::text

  union all select 6, 'modelo = ''   ''  (espacios) →  rechazado', 'false',
    (length(btrim('   ')) > 0)::text

  union all select 7, 'modelo = NULL  →  el CHECK no dispara (permitido)', 'null',
    coalesce((length(btrim(null)) > 0)::text, 'null')

  union all select 8, 'modelo válido  →  aceptado', 'true',
    (length(btrim('un-modelo')) > 0)::text

  -- ── 9-11 · Nada de IA se activó ───────────────────────────────────────────
  union all select 9, 'Filas en evidencia_analisis + revisiones', '0',
    ((select count(*) from public.evidencia_analisis)
   + (select count(*) from public.evidencia_analisis_revisiones))::text

  union all select 10, 'ia_analisis_enabled', 'false',
    coalesce((select value from public.app_config where key='ia_analisis_enabled'),'AUSENTE')

  union all select 11, 'ia_modo_por_defecto', 'prueba',
    coalesce((select value from public.app_config where key='ia_modo_por_defecto'),'AUSENTE')

  union all select 12, 'ia_activacion_desde (vacío)', '(vacio)',
    coalesce(nullif((select value from public.app_config where key='ia_activacion_desde'),''),'(vacio)')

  union all select 13, 'Jobs de cron que toquen IA', '0',
    (select count(*)::text from cron.job
      where command ilike '%evidencia_analisis%' or command ilike '%ia\_%'
         or jobname ilike '%ia-%' or jobname ilike '%vision%')

  union all select 14, 'Cron evaluar-ronda-alertas sigue activo', '1',
    (select count(*)::text from cron.job where jobname='evaluar-ronda-alertas' and active)

  -- ── 15-17 · Nada preexistente fue alterado ────────────────────────────────
  -- Un DROP NOT NULL no dispara triggers de fila: toda configuración debe
  -- seguir con updated_at = created_at.
  union all select 15, 'Configuraciones modificadas por la migración', '0',
    (select count(*)::text from public.ia_configuraciones where updated_at <> created_at)

  union all select 16, 'Filas de prueba residuales (de intentos anteriores)', '0',
    (select count(*)::text from public.ia_configuraciones
      where version in ('__prueba_check__','__prueba_null__'))

  union all select 17, 'Evidencias >= 2101 (línea base)', '>=2101',
    (select case when count(*) >= 2101 then count(*)::text
                 else 'BAJO A ' || count(*)::text end from public.evidencias)

  union all select 18, 'Columnas nuevas NULL en todas las evidencias', '0',
    (select count(*)::text from public.evidencias
      where contenido_sha256 is not null or bytes is not null
         or content_type is not null or updated_at is not null)

  union all select 19, 'Bucket ia-referencias sigue privado', 'privado',
    coalesce((select case when public then 'PUBLICO' else 'privado' end
                from storage.buckets where id='ia-referencias'), 'NO EXISTE')

  -- ── 20-21 · Informativos: comparar con el estado previo ───────────────────
  union all select 20, 'Imágenes de referencia cargadas (informativo)', '—',
    (select count(*)::text from public.ia_referencia_imagenes)

  union all select 21, 'Referencias de punto cargadas (informativo)', '—',
    (select count(*)::text from public.ronda_punto_referencias)
)
select nro, control, esperado, obtenido,
  case
    when nro in (20, 21)                                then 'INFO'
    when nro = 17 and obtenido not like 'BAJO A%'       then 'PASS'
    when obtenido = esperado                            then 'PASS'
    else '*** FAIL ***'
  end as resultado
from c
order by nro;
