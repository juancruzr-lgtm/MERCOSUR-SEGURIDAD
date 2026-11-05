-- Verificación posterior a 20261205140000_documentacion_alertas_listas.
-- SÓLO LECTURA. Una sola sentencia (el editor de Supabase muestra sólo el
-- último select). Todas las filas deben decir ok = true.
select 'documentacion_hoy existe y da la fecha de Argentina' as control,
       (select public.documentacion_hoy() = (now() at time zone 'America/Argentina/Buenos_Aires')::date) as ok,
       (select public.documentacion_hoy()::text) as detalle
union all
select 'funciones nuevas (vigente, aviso_persona)',
       (select count(*) = 2 from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('documentacion_alerta_vigente','documentacion_alertas_aviso_persona')),
       null
union all
select 'ninguna función de alertas usa current_date',
       (select count(*) = 0 from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('documentacion_alertas_generar','documentacion_vencimientos','documentacion_mis_alertas','documentacion_alerta_vigente')
          and prosrc ilike '%current_date%'),
       null
union all
select 'columna credencial_id',
       exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'documentacion_alertas' and column_name = 'credencial_id'),
       null
union all
select 'generar: sólo service_role (ni anon ni authenticated)',
       (select not has_function_privilege('authenticated', 'public.documentacion_alertas_generar()', 'execute')
           and not has_function_privilege('anon', 'public.documentacion_alertas_generar()', 'execute')
           and has_function_privilege('service_role', 'public.documentacion_alertas_generar()', 'execute')),
       null
union all
select 'alerta_vigente: no la llama la app',
       (select not has_function_privilege('authenticated', 'public.documentacion_alerta_vigente(public.documentacion_alertas)', 'execute')),
       null
union all
select 'política de lectura nueva + restrictiva de bajas',
       (select count(*) = 2 from pg_policies where tablename = 'documentacion_alertas'
          and policyname in ('Alertas doc: alertas','acceso_bloqueado_baja')
          and (policyname <> 'Alertas doc: alertas' or qual ilike '%documentacion_alertas_aviso_persona%')),
       null
union all
select 'interruptor SIGUE como estaba (no lo toca la migración)',
       true,
       (select format('activo=%s dias=%s persona=%s faltantes=%s', activo, dias_aviso, avisar_persona, incluir_faltantes)
          from public.documentacion_alertas_config where id = 1)
union all
select 'cron de alertas: programado?',
       true,
       coalesce((select schedule || ' activo=' || active from cron.job where jobname = 'documentacion-alertas'), 'no programado')
union all
select 'alertas registradas (no se borran)',
       true,
       (select count(*)::text from public.documentacion_alertas);
