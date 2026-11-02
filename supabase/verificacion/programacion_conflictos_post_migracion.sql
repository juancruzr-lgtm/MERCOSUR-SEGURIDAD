-- Verificación post-migración 20261125120000 (solo lectura). Correr en la rama
-- de Supabase y, tras aprobación, en producción.
select 'funciones' as chequeo, count(*) = 6 as ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('conflictos_turno_vigilador_core','conflictos_turno_vigilador',
   'asignar_vigilador_turnos','evidencia_turno','corregir_turno_programacion','turnos_auditar_alta');
select 'asignar: una sola sobrecarga' as chequeo, count(*) = 1 as ok
  from pg_proc where proname = 'asignar_vigilador_turnos';
select 'core sin acceso authenticated' as chequeo,
       not has_function_privilege('authenticated', 'public.conflictos_turno_vigilador_core(uuid,date,time,time,uuid,uuid)', 'execute') as ok;
select 'evidencia sin acceso authenticated' as chequeo,
       not has_function_privilege('authenticated', 'public.evidencia_turno(uuid)', 'execute') as ok;
select 'tablas sin escritura directa' as chequeo,
       not has_table_privilege('authenticated', 'public.turnos_correcciones', 'insert')
   and not has_table_privilege('authenticated', 'public.turnos_conflictos_confirmados', 'insert') as ok;
-- Viene de 20261122120000 (#345), que esta migración requiere aplicada antes.
select 'rondas excluye anulados (20261122120000)' as chequeo,
       pg_get_functiondef('public.rondas_ventanas_candidatas'::regproc) like '%''anulado''%' as ok;
select 'trigger alta' as chequeo, exists (select 1 from pg_trigger where tgname = 'trg_turnos_auditar_alta') as ok;
-- Caso real (solo lectura): el turno de Eduardo en Lotuf 29/10 se clasifica con_horas
-- (carga manual de 8 h del 30/10) → la grilla ofrece solicitud, no anulación directa.
select 'caso 29/10' as chequeo, public.evidencia_turno('2aeb0d2c-f203-4e1e-85d1-474a8dfba353') ->> 'clase' as clase;
