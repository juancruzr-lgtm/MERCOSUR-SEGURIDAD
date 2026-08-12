-- ============================================================================
-- POST · Checklist automático — 20260811100000_ia_analisis_base
-- ============================================================================
--
-- Ejecutar COMPLETO después de aplicar la migración.
-- Devuelve una fila por control con PASS / FAIL. No interpreta nada: si hay
-- un solo FAIL, DETENERSE y reportar antes de tocar producción.
--
-- Todo es SELECT. No modifica nada.
--
-- Línea base declarada por la verificación previa a la aplicación:
--   evidencias_total = 2101   ·   sin_objetivo = 0   ·   sin_guardia = 0   ·   sin_turno = 0
--
-- Nota: el control 8 usa >= 2101 a propósito. El sistema está en vivo y pueden
-- entrar fichajes durante la ventana; lo que NO puede pasar es que baje.
-- ============================================================================

with c as (

  -- 1 · Las 6 tablas nuevas existen
  select 1 as nro, 'Las 6 tablas nuevas existen' as control, '6' as esperado,
    (select count(*)::text from information_schema.tables
      where table_schema='public' and table_name in
      ('ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
       'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones')) as obtenido

  -- 2 · Las 6 tablas nuevas están vacías
  union all select 2, 'Las 6 tablas nuevas están vacías', '0',
    ((select count(*) from public.ia_configuraciones)
   + (select count(*) from public.ia_referencia_imagenes)
   + (select count(*) from public.ronda_punto_referencias)
   + (select count(*) from public.ia_lotes)
   + (select count(*) from public.evidencia_analisis)
   + (select count(*) from public.evidencia_analisis_revisiones))::text

  -- 3 · Bucket ia-referencias existe y es PRIVADO
  union all select 3, 'Bucket ia-referencias existe y es privado', 'privado',
    coalesce((select case when public then 'PUBLICO' else 'privado' end
                from storage.buckets where id='ia-referencias'), 'NO EXISTE')

  -- 4 · RLS habilitada en las 6 tablas nuevas
  union all select 4, 'RLS habilitada en las 6 tablas nuevas', '6',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relrowsecurity
        and c.relname in ('ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
                          'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones'))

  -- 5 · Ninguna policy de escritura en las tablas nuevas (solo SELECT)
  union all select 5, 'Policies de escritura en tablas IA (debe ser 0)', '0',
    (select count(*)::text from pg_policies
      where schemaname='public' and cmd <> 'SELECT'
        and tablename in ('ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
                          'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones'))

  -- 6 · authenticated sin INSERT/UPDATE/DELETE sobre las tablas nuevas
  union all select 6, 'GRANT de escritura a authenticated (debe ser 0)', '0',
    (select count(*)::text from information_schema.role_table_grants
      where table_schema='public' and grantee='authenticated'
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
        and table_name in ('ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
                           'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones'))

  -- 7 · anon sin ningún privilegio sobre las tablas nuevas
  union all select 7, 'Privilegios de anon en tablas IA (debe ser 0)', '0',
    (select count(*)::text from information_schema.role_table_grants
      where table_schema='public' and grantee='anon'
        and table_name in ('ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
                           'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones'))

  -- 8 · Las 4 columnas nuevas existen en evidencias
  union all select 8, 'Columnas nuevas en evidencias', '4',
    (select count(*)::text from information_schema.columns
      where table_schema='public' and table_name='evidencias'
        and column_name in ('contenido_sha256','bytes','content_type','updated_at'))

  -- 9 · Las 4 columnas son nullable y sin default
  union all select 9, 'Columnas nuevas nullable y sin default', '4',
    (select count(*)::text from information_schema.columns
      where table_schema='public' and table_name='evidencias'
        and column_name in ('contenido_sha256','bytes','content_type','updated_at')
        and is_nullable='YES' and column_default is null)

  -- 10 · Las evidencias existentes siguen ahí (no bajó de 2101)
  union all select 10, 'Evidencias totales >= 2101 (línea base)', '>=2101',
    (select case when count(*) >= 2101 then count(*)::text
                 else 'BAJO A ' || count(*)::text end from public.evidencias)

  -- 11 · Ninguna evidencia tiene hash / bytes / content_type / updated_at
  union all select 11, 'Columnas nuevas NULL en todas las evidencias', '0',
    (select count(*)::text from public.evidencias
      where contenido_sha256 is not null or bytes is not null
         or content_type is not null or updated_at is not null)

  -- 12 · Las 5 policies de evidencias siguen intactas
  union all select 12, 'Policies de evidencias sin cambios', '5',
    (select count(*)::text from pg_policies
      where schemaname='public' and tablename='evidencias')

  -- 13 · El trigger de validación de ronda sigue vivo
  union all select 13, 'trg_rondas_validar_evidencia_punto intacto', '1',
    (select count(*)::text from pg_trigger
      where tgrelid='public.evidencias'::regclass and not tgisinternal
        and tgname='trg_rondas_validar_evidencia_punto')

  -- 14 · El trigger nuevo de updated_at está instalado
  union all select 14, 'trg_evidencias_updated_at instalado', '1',
    (select count(*)::text from pg_trigger
      where tgrelid='public.evidencias'::regclass and not tgisinternal
        and tgname='trg_evidencias_updated_at')

  -- 15 · ia_analisis_enabled = false
  union all select 15, 'ia_analisis_enabled', 'false',
    coalesce((select value from public.app_config where key='ia_analisis_enabled'),'AUSENTE')

  -- 16 · ia_modo_por_defecto = prueba
  union all select 16, 'ia_modo_por_defecto', 'prueba',
    coalesce((select value from public.app_config where key='ia_modo_por_defecto'),'AUSENTE')

  -- 17 · ia_activacion_desde vacío
  union all select 17, 'ia_activacion_desde (vacío)', '(vacio)',
    coalesce(nullif((select value from public.app_config where key='ia_activacion_desde'),''),'(vacio)')

  -- 18 · Las 7 claves de config existen
  union all select 18, 'Claves ia_* en app_config', '7',
    (select count(*)::text from public.app_config where key like 'ia\_%')

  -- 19 · NO existe ningún cron de IA (el único job debe seguir siendo el de rondas)
  union all select 19, 'Jobs de cron que toquen IA (debe ser 0)', '0',
    (select count(*)::text from cron.job
      where command ilike '%evidencia_analisis%' or command ilike '%ia\_%'
         or jobname ilike '%ia-%' or jobname ilike '%vision%')

  -- 20 · El cron existente sigue siendo exactamente uno y activo
  union all select 20, 'Cron evaluar-ronda-alertas activo', '1',
    (select count(*)::text from cron.job where jobname='evaluar-ronda-alertas' and active)

  -- 21 · Cero filas de análisis (nada se analizó)
  union all select 21, 'Filas en evidencia_analisis', '0',
    (select count(*)::text from public.evidencia_analisis)

  -- 22 · Cero revisiones humanas
  union all select 22, 'Filas en evidencia_analisis_revisiones', '0',
    (select count(*)::text from public.evidencia_analisis_revisiones)

  -- 23 · Las 3 funciones nuevas existen y son SECURITY DEFINER
  union all select 23, 'Funciones IA con SECURITY DEFINER', '3',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and p.proname in ('ia_es_admin','ia_es_operador','ia_registrar_revision'))

  -- 24 · Los 2 índices únicos de idempotencia existen
  union all select 24, 'Índices únicos de idempotencia', '2',
    (select count(*)::text from pg_indexes
      where schemaname='public' and tablename='evidencia_analisis'
        and indexname in ('uq_evidencia_analisis_produccion','uq_evidencia_analisis_prueba'))

  -- 25 · Ninguna función viva lee ronda_punto_referencias (referencia inerte)
  union all select 25, 'Funciones que leen ronda_punto_referencias (debe ser 0)', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosrc like '%ronda_punto_referencias%')

  -- 26 · La única función que menciona evidencia_analisis es la RPC de revisión
  union all select 26, 'Funciones que tocan evidencia_analisis', '1',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosrc like '%evidencia_analisis%')

  -- 27 · El bucket nuevo no tiene policies de storage
  union all select 27, 'Policies de storage sobre ia-referencias (debe ser 0)', '0',
    (select count(*)::text from pg_policies
      where schemaname='storage' and tablename='objects'
        and (qual::text like '%ia-referencias%' or with_check::text like '%ia-referencias%'))

  -- 28 · Los buckets preexistentes no cambiaron de visibilidad
  union all select 28, 'ingreso-evidencias y ronda-evidencias siguen privados', '2',
    (select count(*)::text from storage.buckets
      where id in ('ingreso-evidencias','ronda-evidencias') and not public)
)
select
  nro,
  control,
  esperado,
  obtenido,
  case when obtenido = esperado
         or (nro = 10 and obtenido not like 'BAJO A%')
       then 'PASS' else '*** FAIL ***' end as resultado
from c
order by nro;


-- ── Detalle de apoyo (leer solo si algo dio FAIL) ───────────────────────────

-- Policies creadas por la migración
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname='public' AND tablename IN
--   ('ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
--    'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones')
-- ORDER BY tablename;

-- Todos los jobs de cron
-- SELECT jobid, jobname, schedule, active, command FROM cron.job ORDER BY jobid;

-- Estado de los tres buckets
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;

-- Conteos operativos (deben coincidir con el PRE)
-- SELECT
--   (SELECT count(*) FROM public.evidencias)              AS evidencias,
--   (SELECT count(*) FROM public.registros_asistencia)    AS registros_asistencia,
--   (SELECT count(*) FROM public.turnos)                  AS turnos,
--   (SELECT count(*) FROM public.ronda_alertas)           AS ronda_alertas,
--   (SELECT count(*) FROM public.ronda_puntos)            AS ronda_puntos,
--   (SELECT count(*) FROM public.ronda_ejecucion_puntos)  AS ronda_ejecucion_puntos;
