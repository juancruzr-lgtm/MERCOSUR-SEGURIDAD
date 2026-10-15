-- Verificación posterior a aplicar 20261023120000 (instrucciones y controles
-- propuestos del protocolo). Correr en el editor de Supabase ANTES de desplegar.
--
-- NO DEJA NADA: sólo lee estructura y permisos; no llama a ninguna RPC que
-- escriba. Resultado: la última consulta, una fila por control.
-- Si alguna da false, NO desplegar.

create temp table if not exists verif_protocolo_controles (orden timestamptz default clock_timestamp(), control text, esperado text, obtenido text, ok boolean);
truncate verif_protocolo_controles;

do $verif$
declare
  v_n bigint;
begin
  v_n := (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relrowsecurity
            and c.relname in ('protocolo_instrucciones', 'protocolo_controles_propuestos', 'protocolo_ia_corridas'));
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('3 tablas nuevas con RLS', '3', v_n::text, v_n = 3);

  v_n := (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
            and table_name in ('protocolo_instrucciones', 'protocolo_controles_propuestos', 'protocolo_ia_corridas'));
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('Sin escritura directa para anon/authenticated', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and grantee = 'anon'
            and table_name in ('protocolo_instrucciones', 'protocolo_controles_propuestos', 'protocolo_ia_corridas'));
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('anon sin ningún permiso', '0', v_n::text, v_n = 0);

  v_n := (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'checklist_items' and column_name = 'origen_instruccion_id');
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('checklist_items.origen_instruccion_id', '1', v_n::text, v_n = 1);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef and p.proname in (
            'protocolo_instrucciones_segmentar', 'protocolo_instruccion_validar', 'protocolo_controles_contexto',
            'protocolo_registrar_corrida_ia', 'protocolo_control_proponer', 'protocolo_control_editar',
            'protocolo_control_aprobar', 'protocolo_control_rechazar', 'protocolo_controles_activar',
            'protocolo_controles_panel'));
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('10 RPC SECURITY DEFINER', '10', v_n::text, v_n = 10);

  v_n := (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('protocolo_control_existente', 'protocolo_version_para_preparar')
            and has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('Helpers internos sin EXECUTE para authenticated', '0', v_n::text, v_n = 0);

  -- Nada activado ni plantillas propias al aplicar.
  v_n := (select count(*) from public.protocolo_controles_propuestos);
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('Ningún control cargado al aplicar', '0', v_n::text, v_n = 0);
  v_n := (select count(*) from public.checklist_plantillas where objetivo_id is not null);
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('Ninguna plantilla propia al aplicar', '0', v_n::text, v_n = 0);
  v_n := (select count(*) from public.checklist_items where origen_instruccion_id is not null);
  insert into verif_protocolo_controles (control, esperado, obtenido, ok) values ('Ningún ítem con origen de protocolo al aplicar', '0', v_n::text, v_n = 0);
end
$verif$;

select control, esperado, obtenido, ok from verif_protocolo_controles order by orden;
