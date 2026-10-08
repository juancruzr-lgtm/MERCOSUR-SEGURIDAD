-- Verificación POST de 20261008190000 (una sola sentencia: el editor de
-- Supabase sólo muestra el último SELECT). Esperado: todo OK.
select 'policy_select_alcance' as control,
       case when exists (select 1 from pg_policies where tablename='supervisores_guardia' and policyname='supervisores_guardia_select_alcance') then 'OK' else 'FALTA' end as estado
union all
select 'policy_insert_jefatura',
       case when exists (select 1 from pg_policies where tablename='supervisores_guardia' and policyname='supervisores_guardia_insert_jefatura') then 'OK' else 'FALTA' end
union all
select 'policy_update_jefatura',
       case when exists (select 1 from pg_policies where tablename='supervisores_guardia' and policyname='supervisores_guardia_update_jefatura') then 'OK' else 'FALTA' end
union all
select 'policy_vieja_operador_eliminada',
       case when not exists (select 1 from pg_policies where tablename='supervisores_guardia' and policyname='supervisores_guardia_operador') then 'OK' else 'SIGUE VIVA' end
union all
select 'sin_policy_delete',
       case when not exists (select 1 from pg_policies where tablename='supervisores_guardia' and cmd='DELETE') then 'OK' else 'HAY DELETE' end
union all
select 'delete_revocado',
       case when not exists (select 1 from information_schema.table_privileges
                             where table_name='supervisores_guardia' and grantee='authenticated' and privilege_type in ('DELETE','TRUNCATE'))
            then 'OK' else 'AUTHENTICATED CONSERVA DELETE/TRUNCATE' end
union all
select 'tabla_auditoria',
       case when exists (select 1 from information_schema.tables where table_name='supervisores_guardia_auditoria') then 'OK' else 'FALTA' end
union all
select 'auditoria_escritura_revocada',
       case when not exists (select 1 from information_schema.table_privileges
                             where table_name='supervisores_guardia_auditoria' and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))
            then 'OK' else 'AUTHENTICATED PUEDE ESCRIBIR AUDITORIA' end
union all
select 'trigger_auditoria',
       case when exists (select 1 from pg_trigger where tgname='trg_auditar_supervisores_guardia') then 'OK' else 'FALTA' end
union all
select 'rpc_excepcion',
       case when exists (select 1 from pg_proc where proname='guardia_excepcion_supervisor') then 'OK' else 'FALTA' end
union all
select 'helper_gestionar',
       case when exists (select 1 from pg_proc where proname='puede_gestionar_guardias_actual') then 'OK' else 'FALTA' end
union all
select 'reglas_updated_at',
       case when exists (select 1 from information_schema.columns where table_name='supervisor_guardia_reglas' and column_name='updated_at') then 'OK' else 'FALTA' end;
