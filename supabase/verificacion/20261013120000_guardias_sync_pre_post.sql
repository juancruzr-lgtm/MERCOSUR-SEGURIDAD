-- Verificación POST de 20261013120000 (una sola sentencia). Esperado: todo OK.
select 'rpc_sincronizar' as control,
       case when exists (select 1 from pg_proc where proname='sincronizar_regla_guardias') then 'OK' else 'FALTA' end as estado
union all
select 'rpc_guardar_sincronizada',
       case when exists (select 1 from pg_proc where proname='guardar_regla_sincronizada') then 'OK' else 'FALTA' end
union all
select 'reglas_policy_select_operador',
       case when exists (select 1 from pg_policies where tablename='supervisor_guardia_reglas' and policyname='reglas_select_operador') then 'OK' else 'FALTA' end
union all
select 'reglas_policy_write_jefatura',
       case when exists (select 1 from pg_policies where tablename='supervisor_guardia_reglas' and policyname='reglas_write_jefatura') then 'OK' else 'FALTA' end
union all
select 'reglas_policy_vieja_eliminada',
       case when not exists (select 1 from pg_policies where tablename='supervisor_guardia_reglas' and policyname='supervisor_guardia_reglas_operador') then 'OK' else 'SIGUE VIVA' end
union all
select 'reglas_delete_revocado',
       case when not exists (select 1 from information_schema.table_privileges
                             where table_name='supervisor_guardia_reglas' and grantee='authenticated' and privilege_type in ('DELETE','TRUNCATE'))
            then 'OK' else 'AUTHENTICATED CONSERVA DELETE' end;
