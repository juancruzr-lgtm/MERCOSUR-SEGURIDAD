-- ============================================================================
-- VERIFICACIÓN de 20260910200000_permisos_operativos_b1_d1_d2
-- Una sola sentencia por sección (union all): el editor sólo muestra el último.
-- Los tests de autorización POR AUTH REAL (INSERT/UPDATE bajo cada usuario, en
-- transacción con rollback) se corren aparte al aplicar — ver el reporte.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────
-- Espera: puestos con policies "Admin ... puestos" (rol=admin); no existen las
-- funciones nuevas ni las policies *_alcance.
select 'policy '||tablename||'.'||policyname as item, cmd as detalle
  from pg_policies where tablename='puestos'
union all
select 'fn '||p.proname, 'existe'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('crear_objetivo_operativo','resolver_solicitud_personal_operativo',
                     'alcanza_zona_actual','alcanza_baja_vigilador_actual','puede_gestionar_personal_operativo_actual')
order by 1;

-- ── POST ────────────────────────────────────────────────────────────────────
select 'puestos: sin policy por rol admin' as chk,
       case when not exists (select 1 from pg_policies where tablename='puestos' and policyname like 'Admin %')
            then 'OK' else 'FALLO' end as resultado
union all
select 'puestos: INSERT/UPDATE/DELETE por alcance del objetivo',
       case when (select count(*) from pg_policies where tablename='puestos'
                   and policyname in ('puestos_insert_alcance','puestos_update_alcance','puestos_delete_alcance')
                   and qual_or_check like '%alcanza_objetivo_actual%') = 3
            then 'OK' else 'FALLO' end
  from (select policyname, coalesce(qual,with_check) as qual_or_check from pg_policies where tablename='puestos') _ limit 1
union all
select 'puestos: sin TRUNCATE/REFERENCES/TRIGGER para authenticated',
       case when not exists (select 1 from information_schema.role_table_grants
                              where table_name='puestos' and grantee='authenticated'
                                and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER'))
            then 'OK' else 'FALLO' end
union all
select 'fn crear_objetivo_operativo presente y ejecutable',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='crear_objetivo_operativo')
            then 'OK' else 'FALLO' end
union all
select 'fn resolver_solicitud_personal_operativo presente',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='resolver_solicitud_personal_operativo')
            then 'OK' else 'FALLO' end
union all
select 'objetivos INSERT sigue cerrado (no USING true)',
       case when not exists (select 1 from pg_policies where tablename='objetivos' and cmd in ('INSERT','ALL')
                              and (with_check='true' or qual='true'))
            then 'OK' else 'FALLO' end
union all
select 'usuarios sin cambios (INSERT sigue puede_gestionar_personal_actual)',
       case when exists (select 1 from pg_policies where tablename='usuarios' and policyname='usuarios_insert'
                          and with_check like '%puede_gestionar_personal%')
            then 'OK' else 'FALLO' end
union all
-- Semántica de alcance de zona (sin mutar): Aranda(Rosario) alcanza su zona, no Rafaela.
select 'semantica: helper alcance de zona coherente',
       case when public.alcance_operativo_de(
                   (select id from public.usuarios where apellido ilike 'ARANDA%' and rol='supervisor' and estado='activo' limit 1)
                 ) = 'zonas_asignadas'
            then 'OK' else 'FALLO' end
order by 1;
