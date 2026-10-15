-- Verificación posterior a aplicar 20261023130000 (correcciones de controles
-- del protocolo). Correr en el editor de Supabase ANTES de desplegar el código.
-- Sólo lee estructura y permisos. Si alguna fila da false, NO desplegar.

create temp table if not exists verif_correcciones (orden timestamptz default clock_timestamp(), control text, esperado text, obtenido text, ok boolean);
truncate verif_correcciones;

do $verif$
declare
  v_n bigint;
begin
  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'protocolo_instrucciones_registrar' and p.prosecdef
            and has_function_privilege('authenticated', p.oid, 'EXECUTE')
            and not has_function_privilege('anon', p.oid, 'EXECUTE'));
  insert into verif_correcciones (control, esperado, obtenido, ok) values ('Registrar instrucciones desde citas: SECURITY DEFINER, authenticated sí, anon no', '1', v_n::text, v_n = 1);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'protocolo_instrucciones_segmentar'
            and has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  insert into verif_correcciones (control, esperado, obtenido, ok) values ('División por renglones fuera del alcance de usuarios', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'protocolo_controles_contexto'
            and p.prosrc like '%requiere_identificar%');
  insert into verif_correcciones (control, esperado, obtenido, ok) values ('Contexto con texto completo y requiere_identificar', '1', v_n::text, v_n = 1);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'validar_supervision_plantilla'
            and p.prosrc like '%24 hours%' and p.prosrc like '%tg_op = ''UPDATE''%');
  insert into verif_correcciones (control, esperado, obtenido, ok) values ('Trigger de supervisiones tolera la plantilla anterior y no frena UPDATE', '1', v_n::text, v_n = 1);

  v_n := (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = 'supervisiones' and t.tgname = 'trg_validar_supervision_plantilla' and not t.tgisinternal);
  insert into verif_correcciones (control, esperado, obtenido, ok) values ('El trigger sigue enganchado a supervisiones', '1', v_n::text, v_n = 1);

  v_n := (select count(*) from public.protocolo_controles_propuestos where estado = 'activado');
  insert into verif_correcciones (control, esperado, obtenido, ok) values ('Nada activado', '0', v_n::text, v_n = 0);
end
$verif$;

select control, esperado, obtenido, ok from verif_correcciones order by orden;
