-- ============================================================================
-- Verificación 20260904100000 — novedad mensual informada. Solo lectura.
-- Correr PRE antes y POST después. Cada sección es una única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select 'columnas previas' as control, count(*)::text as resultado, '0' as esperado
  from information_schema.columns
 where table_schema='public' and table_name='novedades_laborales'
   and column_name in ('dias_informados','origen_carga','origen_detalle');

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'columnas nuevas' as control, count(*)::text as resultado, '3' as esperado
    from information_schema.columns
   where table_schema='public' and table_name='novedades_laborales'
     and column_name in ('dias_informados','origen_carga','origen_detalle')
  union all
  select 2, 'filas existentes quedaron como origen app', count(*)::text, '0'
    from public.novedades_laborales where origen_carga <> 'app'
  union all
  select 3, 'constraints nuevos presentes', count(*)::text, '3'
    from pg_constraint
   where conname in ('novedades_laborales_dias_informados_rango',
                     'novedades_laborales_origen_carga_valido',
                     'novedades_laborales_mensual_con_cantidad')
) v order by orden;
