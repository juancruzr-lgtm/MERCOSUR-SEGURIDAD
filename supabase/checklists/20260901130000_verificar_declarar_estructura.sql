-- Checklist post-aplicación de 20260901130000_declarar_estructura_programacion
-- Una sola sentencia (union all): el editor de Supabase muestra solo el último select.

select 'funcion_existe' chequeo,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'declarar_estructura_programacion')::text valor
union all
select 'grant_authenticated',
  (select has_function_privilege('authenticated',
    'public.declarar_estructura_programacion(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'))::text
union all
select 'sin_grant_anon',
  (select not has_function_privilege('anon',
    'public.declarar_estructura_programacion(uuid, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'))::text
union all
select 'check_acciones_ampliado',
  (select pg_get_constraintdef(oid) like '%declarar_servicio_creado%'
   from pg_constraint
   where conname = 'servicios_objetivo_auditoria_accion_check')::text
union all
select 'puesto_id_nuevo_opcional',
  (select not attnotnull from pg_attribute
   where attrelid = 'public.servicios_objetivo_auditoria'::regclass
     and attname = 'puesto_id_nuevo')::text
