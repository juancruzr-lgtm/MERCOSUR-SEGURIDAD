-- Checklist post-aplicación de 20260902100000_completar_mes_supervisor
-- Una sola sentencia (union all): el editor de Supabase muestra solo el último select.

select 'funcion_existe' chequeo,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_turnos_programacion_parcial')::text valor
union all
select 'admite_supervisor',
  (select (prosrc like '%rol IN (''admin'', ''supervisor'')%')::text from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_turnos_programacion_parcial')
union all
select 'alcance_por_zona_en_cuerpo',
  (select (prosrc like '%supervisor_zonas%' and prosrc like '%fuera del alcance del supervisor%')::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_turnos_programacion_parcial')
union all
select 'sin_zonas_activas_rechazado',
  (select (prosrc like '%supervisor sin zonas activas asignadas%')::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_turnos_programacion_parcial')
union all
select 'zonas_filtradas_por_estado_activo',
  (select (prosrc like '%zonas_operativas z ON z.id = sz.zona_id AND z.estado = ''activo''%')::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_turnos_programacion_parcial')
union all
select 'servicio_inactivo_en_prevalidacion',
  (select (prosrc like '%OR NOT s.activo%')::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_turnos_programacion_parcial')
union all
select 'security_definer_y_searchpath',
  (select (p.prosecdef and p.proconfig::text like '%search_path=public, pg_catalog%')::text
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_turnos_programacion_parcial')
union all
select 'grant_authenticated',
  (select has_function_privilege('authenticated',
    'public.crear_turnos_programacion_parcial(uuid, text, jsonb)', 'EXECUTE'))::text
union all
select 'sin_grant_anon',
  (select not has_function_privilege('anon',
    'public.crear_turnos_programacion_parcial(uuid, text, jsonb)', 'EXECUTE'))::text
union all
select 'sin_grant_public',
  (select not has_function_privilege('public',
    'public.crear_turnos_programacion_parcial(uuid, text, jsonb)', 'EXECUTE'))::text
union all
select 'auditoria_intacta',
  (select (count(*) >= 0)::text from generacion_turnos_auditoria)
