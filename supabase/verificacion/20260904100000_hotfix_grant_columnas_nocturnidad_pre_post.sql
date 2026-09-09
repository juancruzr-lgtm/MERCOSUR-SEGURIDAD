-- ============================================================================
-- Verificación del hotfix de columnas de nocturnidad. Solo lectura.
-- Correr PRE antes (y guardar la salida) y POST después. Cada sección es una
-- única sentencia.
-- PRE además CONFIRMA EL BUG: las tres columnas de nocturnidad no deben
-- figurar en la lista (por eso la edición de objetivos falla con 42501).
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'objetivos'
   and grantee = 'authenticated'
   and privilege_type = 'UPDATE'
 order by column_name;

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden,
         'columnas de nocturnidad con UPDATE para authenticated' as control,
         count(*)::text as resultado, '3' as esperado
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'objetivos'
     and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and column_name in ('nocturnidad_activa', 'nocturnidad_desde', 'nocturnidad_hasta')
  union all
  select 2, 'lat/lng/radio_metros siguen SIN update directo', count(*)::text, '0'
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'objetivos'
     and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and column_name in ('lat', 'lng', 'radio_metros')
  union all
  select 3, 'las 9 columnas de 20260815 conservan UPDATE', count(*)::text, '9'
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'objetivos'
     and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and column_name in ('nombre', 'cliente', 'direccion', 'estado',
                         'checklist_plantilla_id', 'frecuencia_supervision_horas',
                         'zona_id', 'es_prueba', 'tipo_ubicacion')
) v
order by orden;
