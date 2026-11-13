-- Verificación posterior de 20261205130000_ronda_control_gps_reincidencia_v2.sql
-- UNA sola sentencia (el editor de Supabase muestra sólo el último SELECT).
-- Sólo lectura. Toda fila debe decir ok = true.
-- Los md5 de las funciones intactas son los de producción leídos el 04/11/2026.
select '01 tabla ronda_punto_control_gps' as control,
       to_regclass('public.ronda_punto_control_gps') is not null as ok,
       coalesce(to_regclass('public.ronda_punto_control_gps')::text, 'falta') as detalle
union all
select '02 columna snap_foto_control_gps boolean not null default false',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'ronda_ejecucion_puntos'
                  and column_name = 'snap_foto_control_gps' and data_type = 'boolean'
                  and is_nullable = 'NO' and column_default = 'false'),
       null
union all
select '03 RLS activa',
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ronda_punto_control_gps')), false),
       null
union all
select '04 políticas: lectura por alcance + acceso_bloqueado_baja restrictiva',
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ronda_punto_control_gps'
          and ((policyname = 'Admin supervisor lee control gps de su alcance' and permissive = 'PERMISSIVE' and cmd = 'SELECT')
            or (policyname = 'acceso_bloqueado_baja' and permissive = 'RESTRICTIVE'))) = 2,
       (select string_agg(policyname || ':' || permissive || ':' || cmd, ' | ' order by policyname)
          from pg_policies where schemaname = 'public' and tablename = 'ronda_punto_control_gps')
union all
select '05 grants: authenticated/service_role sólo SELECT; anon nada (sin DELETE/TRUNCATE)',
       not exists (select 1 from information_schema.role_table_grants
                    where table_schema = 'public' and table_name = 'ronda_punto_control_gps'
                      and grantee in ('anon', 'authenticated', 'service_role')
                      and privilege_type <> 'SELECT')
       and not exists (select 1 from information_schema.role_table_grants
                        where table_schema = 'public' and table_name = 'ronda_punto_control_gps' and grantee = 'anon'),
       (select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type)
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'ronda_punto_control_gps'
           and grantee in ('anon', 'authenticated', 'service_role'))
union all
select '06 triggers snapshot + transición en ronda_ejecucion_puntos',
       (select count(*) from pg_trigger where tgrelid = 'public.ronda_ejecucion_puntos'::regclass and not tgisinternal
          and tgname in ('trg_ronda_control_gps_snapshot', 'trg_ronda_control_gps_transicion')) = 2,
       null
union all
select '07 funciones de trigger sin EXECUTE para authenticated/anon',
       not has_function_privilege('authenticated', 'public.ronda_control_gps_transicion()', 'execute')
       and not has_function_privilege('anon', 'public.ronda_control_gps_snapshot()', 'execute'),
       null
union all
select '08 umbral vigente (default 2 si no hay clave; 0 = sólo registrar)',
       public.ronda_control_gps_umbral() >= 0,
       'umbral=' || public.ronda_control_gps_umbral()::text || ' clave_app_config='
         || coalesce((select value from public.app_config where key = 'ronda_control_gps_umbral'), '(sin clave)')
union all
select '09 rondas_ejecucion_json expone foto_control_gps (y conserva QR)',
       position('foto_control_gps' in pg_get_functiondef('public.rondas_ejecucion_json(uuid)'::regprocedure)) > 0
       and position('qr_disponible' in pg_get_functiondef('public.rondas_ejecucion_json(uuid)'::regprocedure)) > 0,
       null
union all
select '10 detalle de supervisor expone foto_control_gps (y conserva puede_operar)',
       position('foto_control_gps' in pg_get_functiondef('public.rondas_ejecucion_detalle_supervisor(uuid)'::regprocedure)) > 0
       and position('puede_operar_rondas_objetivo(' in pg_get_functiondef('public.rondas_ejecucion_detalle_supervisor(uuid)'::regprocedure)) > 0,
       null
union all
select '11 registrar_punto_ronda intacta (md5 producción)',
       md5(pg_get_functiondef('public.registrar_punto_ronda(uuid,double precision,double precision,double precision,boolean)'::regprocedure))
         = '5b033dc920b6e1c9a046137cb19a38f1',
       null
union all
select '12 iniciar_ronda intacta (md5 producción)',
       md5(pg_get_functiondef('public.iniciar_ronda(uuid)'::regprocedure)) = 'e98d58089c6d95736b42072305d29881',
       null
union all
select '13 validar_qr_ronda_punto intacta (md5 producción)',
       md5(pg_get_functiondef('public.validar_qr_ronda_punto(uuid,text,double precision,double precision,double precision)'::regprocedure))
         = '0e87815b3286b8b860f9e193bffaa709',
       null
union all
select '14 regla aprobada intacta: rondas_veredicto_punto + rondas_estado_foto_punto (md5 producción)',
       md5(pg_get_functiondef('public.rondas_veredicto_punto(boolean,boolean,boolean,text)'::regprocedure)) = '38011d8a58750d674ffd4d80e519439d'
       and md5(pg_get_functiondef('public.rondas_estado_foto_punto(uuid)'::regprocedure)) = '39110c60294696874a61478895dd4f37',
       null
union all
select '15 coherencia: toda visita con pedido de foto tiene desvíos GPS previos del mismo punto',
       not exists (select 1 from public.ronda_ejecucion_puntos ep
                    where ep.snap_foto_control_gps
                      and not exists (select 1 from public.ronda_ejecucion_puntos p
                                       where p.ronda_punto_id = ep.ronda_punto_id
                                         and p.dentro_radio is false
                                         and p.registrado_at < ep.created_at)),
       'visitas_con_pedido=' || (select count(*) from public.ronda_ejecucion_puntos where snap_foto_control_gps)::text
         || ' puntos_con_racha=' || (select count(*) from public.ronda_punto_control_gps where incumplimientos_consecutivos > 0)::text
         || ' puntos_con_pedido=' || (select count(*) from public.ronda_punto_control_gps where foto_requerida_proxima_visita)::text;
