-- Verificación posterior de 20261205120000 / 120100 / 120200 (seguridad Fase 1).
-- Sólo lectura, una sola sentencia. Todas las filas deben dar ok = true.
with
t14(n) as (values ('supervisor_intervenciones'),('solicitudes_admin'),('novedades'),('notificaciones_enviadas'),
  ('push_subscriptions'),('servicios_objetivo'),('horarios_objetivo'),('turnos_base'),('asignaciones'),('reemplazos'),
  ('planillas_mensuales'),('planilla_detalle'),('alertas'),('camaras')),
legadas(n) as (values ('horarios_objetivo'),('asignaciones'),('reemplazos'),('planillas_mensuales'),('planilla_detalle'),('alertas'),('camaras')),
fa(f) as (values ('public.acceso_habilitado_actual()'),('public.alcanza_turno_actual(uuid)'),('public.salida_anticipada_en_alcance(uuid)'),
  ('public.anular_registro_manual(uuid,text)'),('public.resolver_solicitud_personal_operativo(uuid)'),
  ('public.crear_objetivo_operativo(uuid,text,text,text,text,uuid,integer,text,integer,boolean,time,time)')),
fbc(f) as (values ('public.alcanza_baja_vigilador_actual(uuid)'),('public.alcanza_zona_actual(uuid)'),
  ('public.puede_gestionar_personal_operativo_actual()'),('public.puede_resolver_salida_anticipada(uuid,text)'),
  ('public.salida_anticipada_puesto_actual()'),('public.corregir_fecha_registro_manual(uuid,date,text)'),
  ('public.current_user_role()'),('public.current_usuario_id()'),('public.crear_puesto_principal_por_defecto()'),
  ('public.documental_areas_auditar()'),('public.ronda_intervencion_registrar_zona()'),('public.ronda_puntos_no_dejar_ronda_vacia()'),
  ('public.ronda_puntos_no_duplicado()'),('public.rondas_base_exige_puntos()'),('public.tareas_turno_validar_evidencia()'),
  ('public.tg_auditar_supervisores_guardia()'),('public.tg_touch_supervisor_guardia_reglas()'),('public.trg_evaluacion_publicada_historial()'),
  ('public.trg_registro_alerta_salida()'),('public.trg_registro_detectar_salida_anticipada()'),('public.trg_salidas_anticipadas_historial()'),
  ('public.trg_salidas_anticipadas_recalcular()'),('public.turnos_auditar_alta()'),('public.turnos_completar_puesto()'),
  ('public.turnos_validar_superposicion()'),('public.usuarios_proteger_campos_criticos()')),
sp(n) as (values ('asistencia_excepciones_inmutable'),('calcular_horas_liquidables'),('calcular_horas_reconocidas'),('cerrar_turnos_abiertos'),
  ('evaluacion_numero_texto'),('fact_comprobante_inmutable'),('fact_historial_inmutable'),('fact_letra'),('fact_mes_prestacion'),
  ('grupo_orden_banco'),('repdoc_upsert_atomico'),('salida_anticipada_vigente'),('set_actualizado_at'),('set_updated_at'),
  ('touch_checklist_plantillas_updated_at'),('turnos_historial_inmutable'),('update_updated_at'),('validar_puesto_servicio'))
select '1.1 sin políticas abiertas (true/{public}) en las 14 tablas' control,
  not exists (select 1 from pg_policies p join t14 on t14.n = p.tablename where p.schemaname = 'public'
    and p.permissive = 'PERMISSIVE' and (p.qual = 'true' or p.with_check = 'true')) ok
union all select '1.1 acceso_bloqueado_baja sigue en las 14',
  (select count(*) from pg_policies p join t14 on t14.n = p.tablename where p.schemaname = 'public'
    and p.policyname = 'acceso_bloqueado_baja' and p.permissive = 'RESTRICTIVE') = 14
union all select '1.1 supervisor_intervenciones: quedan las de alcance',
  exists (select 1 from pg_policies where tablename = 'supervisor_intervenciones' and policyname = 'Revision operativa lectura por alcance')
  and not exists (select 1 from pg_policies where tablename = 'supervisor_intervenciones' and policyname = 'Acceso total supervisor intervenciones')
union all select '1.1 políticas nuevas creadas (14)',
  (select count(*) from pg_policies where schemaname = 'public' and policyname in ('solicitudes_admin_select','solicitudes_admin_insert',
    'solicitudes_admin_update','novedades_select','novedades_insert','novedades_update','notificaciones_enviadas_select_propias',
    'push_subscriptions_propias','servicios_objetivo_select','servicios_objetivo_insert','servicios_objetivo_update',
    'turnos_base_select','turnos_base_insert','turnos_base_update')) = 14
union all select '1.1 legadas: authenticated y anon sin ningún privilegio',
  not exists (select 1 from information_schema.role_table_grants g join legadas l on l.n = g.table_name
    where g.table_schema = 'public' and g.grantee in ('authenticated','anon'))
union all select '1.1 legadas: service_role conserva acceso',
  (select bool_and(has_table_privilege('service_role', 'public.' || n, 'SELECT,INSERT,UPDATE,DELETE')) from legadas)
union all select '1.1 nadie de la app tiene TRUNCATE en las 14',
  not exists (select 1 from information_schema.role_table_grants g join t14 on t14.n = g.table_name
    where g.table_schema = 'public' and g.grantee in ('authenticated','anon') and g.privilege_type = 'TRUNCATE')
union all select '1.1 notificaciones_enviadas: authenticated sólo SELECT',
  has_table_privilege('authenticated', 'public.notificaciones_enviadas', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notificaciones_enviadas', 'INSERT,UPDATE,DELETE')
union all select '1.1 RLS sigue activo en las 14',
  (select bool_and(c.relrowsecurity) from pg_class c join t14 on t14.n = c.relname where c.relnamespace = 'public'::regnamespace)
union all select '1.2 anon no ejecuta ninguna SECURITY DEFINER de public',
  not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE'))
union all select '1.2 authenticated conserva las 6 de RLS/RPC',
  (select bool_and(has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')) from fa)
union all select '1.2 authenticated ya no ejecuta las 26 internas/trigger',
  (select bool_and(not has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')) from fbc)
union all select '1.2 service_role ejecuta las 32',
  (select bool_and(has_function_privilege('service_role', f::regprocedure, 'EXECUTE')) from (select f from fa union all select f from fbc) x)
union all select '1.2 PUBLIC no figura en el ACL de las 32',
  not exists (select 1 from (select f from fa union all select f from fbc) x
    join pg_proc p on p.oid = x.f::regprocedure, aclexplode(p.proacl) a where a.grantee = 0)
union all select '1.3 las 18 funciones con search_path fijo',
  (select count(distinct p.proname) from pg_proc p join sp on sp.n = p.proname
    where p.pronamespace = 'public'::regnamespace and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 18
union all select '1.3 ninguna función de public con search_path mutable',
  not exists (select 1 from pg_proc p left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and d.objid is null
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
union all select '1.3 cálculo de horas igual (22-06 con 21:55 a 06:10 → 8)',
  public.calcular_horas_liquidables('22:00','06:00','21:55','06:10') = 8.00
union all select '1.3 fact_letra/fact_mes_prestacion iguales',
  public.fact_letra(1) = 'A' and public.fact_letra(201) = 'FCE_A' and public.fact_mes_prestacion('2026-11-01') = '2026-10';
