-- ============================================================================
-- VERIFICACIÓN PRE/POST de 20260910100000_rls_alcance_turnos_registros_objetivos
-- Una sola sentencia por sección (union all): el editor de Supabase sólo
-- muestra el último SELECT.
-- ============================================================================

-- ── PRE (correr y GUARDAR la salida antes de aplicar) ───────────────────────
-- Espera: turnos tiene "Supervisor CRUD turnos" y "Admin CRUD turnos";
-- registros tiene "Supervisor lee registros_asistencia"; objetivos tiene
-- "Admin acceso total objetivos" (public/ALL/true); no existen las policies
-- *_alcance* ni alcanza_turno_actual.
select 'policy '||tablename||'.'||policyname as item,
       'cmd='||cmd||' roles='||array_to_string(roles,',')||' using='||left(coalesce(qual,'-'),80) as detalle
  from pg_policies
 where tablename in ('turnos','registros_asistencia','supervisor_zonas','objetivos')
union all
select 'fn alcanza_turno_actual',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                         where n.nspname='public' and p.proname='alcanza_turno_actual')
            then 'EXISTE' else 'NO EXISTE' end
order by 1;

-- ── POST (correr después de aplicar) ────────────────────────────────────────
-- Todos los checks deben decir OK.
select 'turnos: sin policy global por rol' as chk,
       case when not exists (select 1 from pg_policies where tablename='turnos'
                              and policyname in ('Supervisor CRUD turnos','Admin CRUD turnos'))
            then 'OK' else 'FALLO' end as resultado
union all
select 'turnos: turnos_alcance_operativo (ALL, canónica)',
       case when exists (select 1 from pg_policies where tablename='turnos'
                          and policyname='turnos_alcance_operativo' and cmd='ALL'
                          and qual like '%alcanza_objetivo_actual%')
            then 'OK' else 'FALLO' end
union all
select 'turnos: guardia conserva su SELECT propio',
       case when exists (select 1 from pg_policies where tablename='turnos'
                          and policyname='Guardia lee sus turnos')
            then 'OK' else 'FALLO' end
union all
select 'registros: sin SELECT global de supervisor',
       case when not exists (select 1 from pg_policies where tablename='registros_asistencia'
                              and policyname='Supervisor lee registros_asistencia')
            then 'OK' else 'FALLO' end
union all
select 'registros: select por alcance (alcanza_turno_actual)',
       case when exists (select 1 from pg_policies where tablename='registros_asistencia'
                          and policyname='registros_asistencia_select_alcance'
                          and qual like '%alcanza_turno_actual%')
            then 'OK' else 'FALLO' end
union all
select 'registros: admin y guardia intactos',
       case when exists (select 1 from pg_policies where tablename='registros_asistencia'
                          and policyname='Admin CRUD registros_asistencia')
             and exists (select 1 from pg_policies where tablename='registros_asistencia'
                          and policyname='Guardia gestiona sus registros')
            then 'OK' else 'FALLO' end
union all
select 'supervisor_zonas: lectura operativa SOLO select',
       case when exists (select 1 from pg_policies where tablename='supervisor_zonas'
                          and policyname='supervisor_zonas_lectura_operativa' and cmd='SELECT')
             and not exists (select 1 from pg_policies where tablename='supervisor_zonas'
                              and policyname='supervisor_zonas_lectura_operativa' and cmd<>'SELECT')
            then 'OK' else 'FALLO' end
union all
select 'objetivos: ninguna policy con USING true',
       case when not exists (select 1 from pg_policies where tablename='objetivos'
                              and (qual='true' or (qual is null and with_check='true')))
            then 'OK' else 'FALLO' end
union all
select 'objetivos: 4 policies nuevas presentes',
       case when (select count(*) from pg_policies where tablename='objetivos'
                   and policyname in ('objetivos_select_usuario_activo','objetivos_insert_admin',
                                      'objetivos_update_operador','objetivos_delete_admin')) = 4
            then 'OK' else 'FALLO' end
union all
select 'objetivos: sin TRUNCATE/REFERENCES/TRIGGER para authenticated',
       case when not exists (select 1 from information_schema.role_table_grants
                              where table_name='objetivos' and grantee='authenticated'
                                and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER'))
            then 'OK' else 'FALLO' end
union all
select 'semántica: supervisor Rosario NO alcanza CYE (Rafaela)',
       case when public.alcanza_objetivo(
              (select id from public.usuarios where apellido ilike 'ARANDA%' and rol='supervisor' and estado='activo' limit 1),
              (select id from public.objetivos where nombre ilike '%CYE%' limit 1)) = false
            then 'OK' else 'FALLO' end
union all
select 'semántica: Wilhjelm (Rafaela) SÍ alcanza CYE',
       case when public.alcanza_objetivo(
              (select id from public.usuarios where apellido ilike 'WILHJELM%' and estado='activo' limit 1),
              (select id from public.objetivos where nombre ilike '%CYE%' limit 1)) = true
            then 'OK' else 'FALLO' end
union all
select 'semántica: gerencia alcanza todo (incl. sin zona)',
       case when public.alcanza_objetivo(
              (select id from public.usuarios where puesto_organizacional='gerencia' and estado='activo' limit 1),
              (select id from public.objetivos where zona_id is null limit 1)) = true
            then 'OK' else 'FALLO' end
order by 1;
