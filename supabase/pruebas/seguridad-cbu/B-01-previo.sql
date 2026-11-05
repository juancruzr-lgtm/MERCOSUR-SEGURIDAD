-- #381 · ETAPA B · CONTROL PREVIO (sólo lectura, una sola sentencia)
-- Correr ANTES de 20261207100100 y SÓLO con el deploy de #381 ya confirmado en producción
-- (ver LEEME: control del deploy). Todas las filas deben dar ok = true.
select 'etapa A aplicada: existe usuarios_cuentas_bancarias()' as control,
       to_regprocedure('public.usuarios_cuentas_bancarias()') is not null as ok
union all select 'etapa B no aplicada todavía (authenticated conserva SELECT de tabla)',
       has_table_privilege('authenticated', 'public.usuarios', 'select')
union all select 'usuarios tiene exactamente las 25 columnas previstas (ninguna nueva)',
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usuarios') = 25
       and not exists (
         select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'usuarios'
            and c.column_name <> all (array['id','nombre','apellido','dni','telefono','legajo','rol','estado','foto_url','auth_user_id','created_at','email','cuil','legajo_visual','es_prueba','puesto_organizacional','acceso_interfaz_admin','acceso_admin_pleno','excluir_pago_banco','acceso_bloqueado','acceso_bloqueado_motivo','acceso_bloqueado_at','acceso_bloqueado_por','acceso_auth_bloqueado_at','cuenta_bancaria']))
union all select 'ninguna política RLS menciona cuenta_bancaria',
       not exists (select 1 from pg_policies where schemaname = 'public'
                    and (coalesce(qual, '') ilike '%cuenta_bancaria%' or coalesce(with_check, '') ilike '%cuenta_bancaria%'))
union all select 'ninguna función SECURITY INVOKER lee cuenta_bancaria (las DEFINER no cambian)',
       not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and not prosecdef and prosrc ilike '%cuenta_bancaria%')
union all select 'usuarios no está publicada en Realtime',
       not exists (select 1 from pg_publication_tables where schemaname = 'public' and tablename = 'usuarios');
