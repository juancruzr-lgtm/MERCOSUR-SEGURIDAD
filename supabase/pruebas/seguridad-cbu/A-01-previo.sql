-- #381 · ETAPA A · CONTROL PREVIO (sólo lectura, una sola sentencia)
-- Correr ANTES de 20261207100000. Todas las filas deben dar ok = true.
select 'la RPC todavía no existe (etapa A no aplicada)' as control,
       to_regprocedure('public.usuarios_cuentas_bancarias()') is null as ok
union all select 'versiones 20261207100000 / 20261207100100 no figuran en el historial',
       not exists (select 1 from supabase_migrations.schema_migrations where version in ('20261207100000', '20261207100100'))
union all select 'existen puede_liquidar_actual() y puede_acceder_gerencia_actual()',
       to_regprocedure('public.puede_liquidar_actual()') is not null
       and to_regprocedure('public.puede_acceder_gerencia_actual()') is not null
union all select 'usuarios.cuenta_bancaria existe y es text',
       (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'usuarios' and column_name = 'cuenta_bancaria') = 'text'
union all select 'hoy authenticated tiene SELECT de tabla sobre usuarios (estado expuesto que se corrige en B)',
       has_table_privilege('authenticated', 'public.usuarios', 'select');
