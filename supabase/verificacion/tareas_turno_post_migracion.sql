-- Verificación posterior a aplicar 20261024120000 (tareas del turno). Correr en
-- el editor de Supabase ANTES de desplegar. Sólo lee. Si algo da false, NO desplegar.

create temp table if not exists verif_tareas (orden timestamptz default clock_timestamp(), control text, esperado text, obtenido text, ok boolean);
truncate verif_tareas;

do $verif$
declare
  v_n bigint;
begin
  v_n := (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relrowsecurity and c.relname in ('tareas_turno_definiciones', 'tareas_turno_registros'));
  insert into verif_tareas (control, esperado, obtenido, ok) values ('2 tablas con RLS', '2', v_n::text, v_n = 2);

  v_n := (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and table_name in ('tareas_turno_definiciones', 'tareas_turno_registros')
            and grantee in ('anon', 'authenticated') and (grantee = 'anon' or privilege_type <> 'SELECT'));
  insert into verif_tareas (control, esperado, obtenido, ok) values ('Sin escritura directa ni acceso anon', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef and p.proname in (
            'tareas_turno_activar', 'tareas_turno_desactivar', 'tareas_turno_mias', 'tareas_turno_registrar',
            'tareas_turno_destino_foto', 'tareas_turno_ver_foto', 'tareas_turno_panel'));
  insert into verif_tareas (control, esperado, obtenido, ok) values ('7 RPC SECURITY DEFINER', '7', v_n::text, v_n = 7);

  v_n := (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = 'evidencias' and t.tgname = 'trg_tareas_turno_validar_evidencia');
  insert into verif_tareas (control, esperado, obtenido, ok) values ('Trigger de evidencia de tareas en evidencias', '1', v_n::text, v_n = 1);

  v_n := (select count(*) from public.tareas_turno_definiciones);
  insert into verif_tareas (control, esperado, obtenido, ok) values ('Ninguna tarea activada al aplicar', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from public.ia_configuraciones where analisis_tipo = 'tarea_turno' and activo);
  insert into verif_tareas (control, esperado, obtenido, ok) values ('La IA de fotos no procesa evidencias de tareas', '0', v_n::text, v_n = 0);
end
$verif$;

select control, esperado, obtenido, ok from verif_tareas order by orden;
