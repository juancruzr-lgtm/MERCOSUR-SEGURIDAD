-- ============================================================================
-- Verificación M4 — tablas muertas. Solo lectura.
-- Dos sentencias independientes: correr PRE antes de la migración (y GUARDAR
-- la salida: es la fuente del rollback exacto) y POST después. Cada una es
-- una única sentencia (el editor de Supabase sólo muestra el último SELECT).
-- ============================================================================

-- ── PRE: capturar políticas y grants vigentes de las 8 tablas ───────────────

select 'politica' as tipo, tablename as tabla, policyname as detalle,
       cmd as comando, coalesce(roles::text, '') as roles,
       coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('alertas','camaras','asignaciones','horarios_objetivo',
                     'planilla_detalle','planillas_mensuales','reemplazos',
                     'repositorio_documental')
union all
select 'grant', table_name, grantee, privilege_type, '', '', ''
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('alertas','camaras','asignaciones','horarios_objetivo',
                      'planilla_detalle','planillas_mensuales','reemplazos',
                      'repositorio_documental')
   and grantee in ('anon', 'authenticated')
 order by 1, 2, 3;

-- ── POST: todo en cero ──────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'politicas laxas restantes (qual/with_check = true)' as control,
         count(*)::text as resultado, '0' as esperado
    from pg_policies
   where schemaname = 'public'
     and tablename in ('alertas','camaras','asignaciones','horarios_objetivo',
                       'planilla_detalle','planillas_mensuales','reemplazos',
                       'repositorio_documental')
     and (qual = 'true' or (qual is null and with_check = 'true'))
  union all
  select 2, 'tablas del grupo con RLS deshabilitada', count(*)::text, '0'
    from pg_tables
   where schemaname = 'public'
     and tablename in ('alertas','camaras','asignaciones','horarios_objetivo',
                       'planilla_detalle','planillas_mensuales','reemplazos',
                       'repositorio_documental')
     and not rowsecurity
  union all
  select 3, 'privilegios restantes de anon/authenticated', count(*)::text, '0'
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('alertas','camaras','asignaciones','horarios_objetivo',
                        'planilla_detalle','planillas_mensuales','reemplazos',
                        'repositorio_documental')
     and grantee in ('anon', 'authenticated')
) v
order by orden;
