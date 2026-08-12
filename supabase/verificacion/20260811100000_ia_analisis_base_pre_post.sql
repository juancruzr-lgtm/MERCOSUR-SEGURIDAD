-- Verificación PRE/POST — IA análisis de imágenes, FASE A (modelo de datos)
--
-- Todo es SELECT. Ejecutar el bloque PRE antes de aplicar la migración y el
-- bloque POST después, comparando los conteos de línea base.

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PRE — antes de aplicar                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- 1. Ninguna de las tablas nuevas existe todavía.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN (
  'ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
  'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones');
-- Esperado: 0 filas.

-- 2. Las funciones nuevas tampoco.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('ia_es_admin','ia_es_operador','ia_registrar_revision');
-- Esperado: 0 filas.

-- 3. `evidencias` no tiene las columnas nuevas.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'evidencias'
  AND column_name IN ('contenido_sha256','bytes','content_type','updated_at');
-- Esperado: 0 filas.

-- 4. LÍNEA BASE — estos números NO deben cambiar con la migración.
SELECT count(*) AS evidencias_total FROM public.evidencias;
SELECT count(*) AS registros_asistencia_total FROM public.registros_asistencia;
SELECT count(*) AS turnos_total FROM public.turnos;
SELECT count(*) AS ronda_alertas_total FROM public.ronda_alertas;
SELECT count(*) AS ronda_puntos_total FROM public.ronda_puntos;
SELECT count(*) AS ronda_ejecucion_puntos_total FROM public.ronda_ejecucion_puntos;

-- 5. LÍNEA BASE — policies vivas de `evidencias` (la migración no las toca).
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'evidencias' ORDER BY policyname;
-- Esperado: las 5 existentes, idénticas antes y después.

-- 6. LÍNEA BASE — triggers de `evidencias`.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.evidencias'::regclass AND NOT tgisinternal ORDER BY tgname;

-- 7. LÍNEA BASE — buckets y objetos.
SELECT id, public, file_size_limit FROM storage.buckets ORDER BY id;
SELECT bucket_id, count(*) AS objetos FROM storage.objects GROUP BY bucket_id ORDER BY bucket_id;

-- 8. Dependencias presentes (si alguna falta, la migración aborta sola).
SELECT p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('puede_administrar_rondas_objetivo','rondas_usuario_actual_id','set_updated_at');
-- Esperado: 3 filas.


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ POST — después de aplicar                                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- 9. Las 6 tablas existen y TODAS tienen RLS activa.
SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN (
  'ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
  'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones')
ORDER BY c.relname;
-- Esperado: 6 filas, relrowsecurity = true en todas.

-- 10. Policies creadas: SOLO de tipo SELECT. Ni un INSERT/UPDATE/DELETE.
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename IN (
  'ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
  'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones')
ORDER BY tablename, policyname;
-- Esperado: 6 filas, cmd = 'SELECT' en todas.

-- 11. Grants: `authenticated` sólo SELECT, `anon` nada.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('ia_configuraciones','ia_referencia_imagenes','ronda_punto_referencias',
                     'ia_lotes','evidencia_analisis','evidencia_analisis_revisiones')
  AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee, privilege_type;
-- Esperado: sólo pares (authenticated, SELECT). Ninguna fila con grantee='anon'.

-- 12. El alcance por zona quedó cableado (no un chequeo de rol pelado).
SELECT tablename, policyname, qual FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('evidencia_analisis','evidencia_analisis_revisiones','ronda_punto_referencias');
-- Esperado: las 3 mencionan puede_administrar_rondas_objetivo.

-- 13. Índices de idempotencia presentes y parciales.
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'evidencia_analisis'
ORDER BY indexname;
-- Esperado: uq_evidencia_analisis_produccion  (WHERE modo = 'produccion')
--           uq_evidencia_analisis_prueba      (WHERE modo = 'prueba' AND lote_id IS NOT NULL)
--           + los 6 índices de trabajo.

-- 14. Columnas nuevas en `evidencias`, todas nullable y sin default.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'evidencias'
  AND column_name IN ('contenido_sha256','bytes','content_type','updated_at')
ORDER BY column_name;
-- Esperado: 4 filas, is_nullable = YES, column_default = NULL en las 4.

-- 15. NINGUNA fila de `evidencias` fue tocada por la migración.
SELECT count(*) AS evidencias_total FROM public.evidencias;                 -- = PRE §4
SELECT count(*) AS con_hash FROM public.evidencias WHERE contenido_sha256 IS NOT NULL;  -- = 0
SELECT count(*) AS con_updated_at FROM public.evidencias WHERE updated_at IS NOT NULL;  -- = 0

-- 16. Los conteos operativos son idénticos al PRE.
SELECT count(*) AS registros_asistencia_total FROM public.registros_asistencia;
SELECT count(*) AS turnos_total FROM public.turnos;
SELECT count(*) AS ronda_alertas_total FROM public.ronda_alertas;
SELECT count(*) AS ronda_puntos_total FROM public.ronda_puntos;
SELECT count(*) AS ronda_ejecucion_puntos_total FROM public.ronda_ejecucion_puntos;

-- 17. Las policies de `evidencias` siguen exactamente iguales.
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'evidencias' ORDER BY policyname;
-- Esperado: idéntico al PRE §5.

-- 18. Triggers de `evidencias`: los previos + trg_evidencias_updated_at.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.evidencias'::regclass AND NOT tgisinternal ORDER BY tgname;
-- Esperado: PRE §6 + 'trg_evidencias_updated_at'. trg_rondas_validar_evidencia_punto intacto.

-- 19. Bucket nuevo, privado, con límite y MIME. Los otros dos sin cambios.
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets ORDER BY id;
-- Esperado: ia-referencias privado, 5242880, [jpeg,png,webp].
--           ingreso-evidencias y ronda-evidencias idénticos al PRE §7.

-- 20. El bucket nuevo NO tiene policies de storage (acceso sólo service_role).
SELECT policyname FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND qual::text LIKE '%ia-referencias%';
-- Esperado: 0 filas.

-- 21. Funciones nuevas presentes y SECURITY DEFINER.
SELECT p.proname, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('ia_es_admin','ia_es_operador','ia_registrar_revision')
ORDER BY p.proname;
-- Esperado: 3 filas, prosecdef = true en las 3.

-- 22. app_config: las 7 claves, todas apagadas / en prueba.
SELECT key, value FROM public.app_config WHERE key LIKE 'ia_%' ORDER BY key;
-- Esperado:
--   ia_activacion_desde         = ''          ← nada entra a producción
--   ia_analisis_enabled         = 'false'     ← interruptor general apagado
--   ia_lote_max                 = '10'
--   ia_max_intentos             = '5'
--   ia_modo_por_defecto         = 'prueba'
--   ia_muestra_normales_por_dia = '10'
--   ia_tipos_activos            = 'uniforme,libro_guardia'

-- 23. Las tablas nuevas arrancan vacías.
SELECT
  (SELECT count(*) FROM public.ia_configuraciones)            AS configuraciones,
  (SELECT count(*) FROM public.ia_referencia_imagenes)        AS referencias,
  (SELECT count(*) FROM public.ronda_punto_referencias)       AS ref_puntos,
  (SELECT count(*) FROM public.ia_lotes)                      AS lotes,
  (SELECT count(*) FROM public.evidencia_analisis)            AS analisis,
  (SELECT count(*) FROM public.evidencia_analisis_revisiones) AS revisiones;
-- Esperado: 0 en las seis.

-- 24. Ninguna función viva de rondas lee las tablas nuevas
--     (confirma que §38 se cumple: la referencia es metadata inerte).
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc LIKE '%ronda_punto_referencias%';
-- Esperado: 0 filas.

-- 25. Ninguna función viva escribe en las tablas de IA todavía.
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosrc LIKE '%evidencia_analisis%'
ORDER BY p.proname;
-- Esperado: sólo 'ia_registrar_revision'.


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ PRUEBAS FUNCIONALES DE RLS  (ejecutar con sesión real, no como postgres)║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Requieren un JWT real de cada rol; el rol `postgres` del SQL Editor omite RLS
-- y devuelve todo, así que estas consultas NO prueban nada corridas como postgres.
--
-- A) Como ADMIN         → debe ver todas las filas de evidencia_analisis.
--    SELECT count(*) FROM public.evidencia_analisis;
--
-- B) Como SUPERVISOR    → sólo objetivos de sus zonas.
--    SELECT count(*) FROM public.evidencia_analisis;
--    SELECT count(*) FROM public.evidencia_analisis ea
--     WHERE NOT EXISTS (SELECT 1 FROM public.objetivos o
--                        JOIN public.supervisor_zonas sz ON sz.zona_id = o.zona_id
--                       WHERE o.id = ea.objetivo_id
--                         AND sz.supervisor_id = public.rondas_usuario_actual_id());
--    → la segunda debe dar 0. Si da > 0, la RLS no está filtrando.
--
-- C) Como VIGILADOR     → 0 filas en las SEIS tablas. No ve nada nuevo.
--    SELECT count(*) FROM public.evidencia_analisis;             -- 0
--    SELECT count(*) FROM public.evidencia_analisis_revisiones;  -- 0
--    SELECT count(*) FROM public.ia_configuraciones;             -- 0
--    SELECT count(*) FROM public.ia_referencia_imagenes;         -- 0
--    SELECT count(*) FROM public.ia_lotes;                       -- 0
--    SELECT count(*) FROM public.ronda_punto_referencias;        -- 0
--
-- D) Escritura directa bloqueada para TODOS los roles de cliente:
--    INSERT INTO public.evidencia_analisis (evidencia_id) VALUES (gen_random_uuid());
--    → debe fallar por falta de privilegio (no hay GRANT INSERT ni policy).
--
-- E) La RPC valida alcance: como SUPERVISOR, sobre un análisis de otra zona,
--    SELECT public.ia_registrar_revision('<id-fuera-de-zona>', 'CORRECTO');
--    → debe fallar con 'Sin alcance sobre el objetivo de esta evidencia'.
--
-- F) El fichaje sigue funcionando (la prueba que más importa):
--    hacer un ingreso real de prueba en Casa Juan y confirmar que
--    /api/upload-evidence responde 200 y crea las 2 filas de evidencias.
--    Las columnas nuevas quedan NULL: la FASE C todavía no las llena.
