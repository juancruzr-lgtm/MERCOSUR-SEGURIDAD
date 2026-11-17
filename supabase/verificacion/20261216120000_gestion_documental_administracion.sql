-- Verificación posterior a 20261216120000_gestion_documental_administracion. Sólo lectura.

-- 1. 12 tablas con RLS activa (todas rls = true)
select relname, relrowsecurity as rls from pg_class
where relnamespace = 'public'::regnamespace and relname in ('gestion_proveedores','gestion_obligaciones','gestion_responsables',
  'gestion_documentos','gestion_documento_eventos','gestion_seguimientos','gestion_seguimiento_eventos','gestion_tareas_admin',
  'gestion_tarea_eventos','gestion_reclamos','gestion_informes_mensuales','gestion_recordatorios_config');

-- 2. Obligaciones: ninguna legal "confirmada" sin norma/fuente/fecha (0 filas)
select codigo from public.gestion_obligaciones
where tipo_fuente = 'legal' and validacion = 'confirmada' and (norma is null or fuente_url is null or verificado_at is null);

-- 3. Responsables sin personas precargadas (7 filas, titular null)
select funcion, titular_id from public.gestion_responsables order by funcion;

-- 4. Recordatorios apagados (activo = false, canal = ninguno)
select activo, canal from public.gestion_recordatorios_config;

-- 5. authenticated sin escritura directa en gestion_* nuevas (0 filas)
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'authenticated' and table_name in ('gestion_documentos','gestion_seguimientos','gestion_tareas_admin','gestion_reclamos','gestion_informes_mensuales')
  and privilege_type <> 'SELECT';

-- 6. Bucket privado y sin políticas (public = false; 0 políticas)
select id, public from storage.buckets where id = 'gestion-documentos';
select policyname from pg_policies where schemaname = 'storage' and qual ilike '%gestion-documentos%';

-- 7. Ningún cron nuevo (0 filas)
select jobname from cron.job where jobname ilike '%gestion%' or jobname ilike '%vencim%';
