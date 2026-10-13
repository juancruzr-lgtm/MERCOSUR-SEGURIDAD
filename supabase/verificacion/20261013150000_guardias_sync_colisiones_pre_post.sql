-- Verificación POST de 20261013150000 (una sola sentencia). Esperado: todo OK.
select 'rpc_sincronizar_con_destino' as control,
       case when exists (select 1 from pg_proc where proname='sincronizar_regla_guardias'
                           and pg_get_functiondef(oid) like '%desvinculadas%') then 'OK' else 'FALTA (versión vieja)' end as estado
union all
select 'rpc_sincronizar_programacion',
       case when exists (select 1 from pg_proc where proname='sincronizar_programacion') then 'OK' else 'FALTA' end
union all
select 'helper_interno',
       case when exists (select 1 from pg_proc where proname='_sincronizar_programacion_aplicar') then 'OK' else 'FALTA' end
union all
select 'helper_sin_permisos_authenticated',
       case when not exists (
         select 1 from information_schema.routine_privileges
         where routine_name='_sincronizar_programacion_aplicar' and grantee in ('authenticated','anon','PUBLIC'))
            then 'OK' else 'EXPUESTO' end
union all
select 'reglas_policy_write_jefatura',
       case when exists (select 1 from pg_policies where tablename='supervisor_guardia_reglas' and policyname='reglas_write_jefatura') then 'OK' else 'FALTA' end
union all
select 'rpc_guardar_sincronizada',
       case when exists (select 1 from pg_proc where proname='guardar_regla_sincronizada') then 'OK' else 'FALTA' end;
