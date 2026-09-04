-- ============================================================================
-- Verificación 20260903170000 — nocturnidad del objetivo. Solo lectura.
-- Correr PRE antes y POST después. Cada sección es una única sentencia.
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────
-- Las columnas no deben existir todavía y el trigger debe estar en su versión
-- previa (sólo lat/lng/radio_metros).

select 'columna_previa' as control, count(*)::text as resultado, '0' as esperado
  from information_schema.columns
 where table_schema = 'public' and table_name = 'objetivos'
   and column_name like 'nocturnidad%';

-- ── POST ────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'columnas de nocturnidad en objetivos' as control,
         count(*)::text as resultado, '3' as esperado
    from information_schema.columns
   where table_schema = 'public' and table_name = 'objetivos'
     and column_name in ('nocturnidad_activa', 'nocturnidad_desde', 'nocturnidad_hasta')
  union all
  select 2, 'objetivos con nocturnidad activa (nada se activa por migración)',
         count(*)::text, '0'
    from public.objetivos where nocturnidad_activa
  union all
  select 3, 'CHECK de franja completa presente', count(*)::text, '1'
    from pg_constraint
   where conname = 'objetivos_nocturnidad_completa'
  union all
  select 4, 'trigger de auditoría audita nocturnidad',
         case when pg_get_functiondef('public.objetivos_auditar_cambio()'::regprocedure) like '%nocturnidad_activa%' then 'si' else 'NO' end,
         'si'
) v order by orden;
