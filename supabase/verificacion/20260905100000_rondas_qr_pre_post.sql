-- ============================================================================
-- VERIFICACIÓN · 20260905100000_rondas_qr_puntos
-- ============================================================================
-- Una sola sentencia (union all): el editor de Supabase sólo muestra el último
-- SELECT. Ejecutar DESPUÉS de aplicar la migración; todo debe dar OK.
-- ============================================================================

select 'ronda_puntos.qr_modo existe' as chequeo,
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ronda_puntos'
            and column_name = 'qr_modo'
       ) then 'OK' else 'FALTA' end as resultado

union all
select 'ronda_puntos.qr_modo: todos desactivado (recién migrado)',
       case when not exists (
         select 1 from public.ronda_puntos where qr_modo <> 'desactivado'
       ) then 'OK' else 'HAY PUNTOS CON QR (esperado sólo tras configurar)' end

union all
select 'tabla ronda_punto_qr existe',
       case when to_regclass('public.ronda_punto_qr') is not null
            then 'OK' else 'FALTA' end

union all
select 'ronda_punto_qr: RLS habilitada',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.ronda_punto_qr'::regclass)
            then 'OK' else 'SIN RLS' end

union all
select 'ronda_punto_qr: SIN grants a authenticated (ni SELECT)',
       case when not exists (
         select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'ronda_punto_qr'
            and grantee in ('authenticated', 'anon')
       ) then 'OK' else 'FUGA DE GRANTS' end

union all
select 'ronda_punto_qr: índice único de credencial activa',
       case when exists (
         select 1 from pg_indexes
          where schemaname = 'public' and tablename = 'ronda_punto_qr'
            and indexname = 'ronda_punto_qr_una_activa'
       ) then 'OK' else 'FALTA' end

union all
select 'ronda_ejecucion_puntos: columnas QR completas',
       case when (
         select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'ronda_ejecucion_puntos'
            and column_name in ('snap_qr_modo', 'qr_verificado_at', 'qr_credencial_id',
                                'qr_latitud', 'qr_longitud', 'qr_precision_metros',
                                'qr_distancia_metros', 'qr_intentos_invalidos')
       ) = 8 then 'OK' else 'FALTAN COLUMNAS' end

union all
select 'RPC validar_qr_ronda_punto existe',
       case when to_regprocedure('public.validar_qr_ronda_punto(uuid, text, double precision, double precision, double precision)') is not null
            then 'OK' else 'FALTA' end

union all
select 'RPC generar_qr_ronda_punto existe',
       case when to_regprocedure('public.generar_qr_ronda_punto(uuid, boolean)') is not null
            then 'OK' else 'FALTA' end

union all
select 'RPC obtener_qr_ronda_punto existe',
       case when to_regprocedure('public.obtener_qr_ronda_punto(uuid)') is not null
            then 'OK' else 'FALTA' end

union all
select 'RPC QR: security definer las tres',
       case when (
         select count(*) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('validar_qr_ronda_punto', 'generar_qr_ronda_punto', 'obtener_qr_ronda_punto')
           and p.prosecdef
       ) = 3 then 'OK' else 'FALTA SECURITY DEFINER' end

union all
select 'iniciar_ronda congela snap_qr_modo',
       case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'iniciar_ronda'
           and p.prosrc like '%snap_qr_modo%'
       ) then 'OK' else 'VERSION VIEJA' end

union all
select 'registrar_punto_ronda juzga el QR',
       case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'registrar_punto_ronda'
           and p.prosrc like '%v_qr_exigible%'
       ) then 'OK' else 'VERSION VIEJA' end

union all
select 'rondas_ejecucion_json expone qr_verificado',
       case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'rondas_ejecucion_json'
           and p.prosrc like '%qr_verificado%'
       ) then 'OK' else 'VERSION VIEJA' end

union all
select 'detalle_supervisor expone qr_verificado_at',
       case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'rondas_ejecucion_detalle_supervisor'
           and p.prosrc like '%qr_verificado_at%'
       ) then 'OK' else 'VERSION VIEJA' end

union all
select 'trigger de auditoría audita qr_modo',
       case when exists (
         select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ronda_puntos_auditar_cambio'
           and p.prosrc like '%qr_modo%'
       ) then 'OK' else 'VERSION VIEJA' end

union all
select 'grant update(qr_modo) a authenticated',
       case when exists (
         select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'ronda_puntos'
            and column_name = 'qr_modo' and grantee = 'authenticated'
            and privilege_type = 'UPDATE'
       ) then 'OK' else 'FALTA' end

union all
select 'ejecuciones históricas intactas (snap_qr_modo = desactivado)',
       case when not exists (
         select 1 from public.ronda_ejecucion_puntos
          where snap_qr_modo <> 'desactivado'
       ) then 'OK' else 'HAY SNAPSHOTS CON QR (esperado sólo tras configurar)' end;
