-- ============================================================================
-- Verificación 20260903180000 — excepciones y ajuste de nocturnidad.
-- Solo lectura. Correr PRE antes y POST después. Cada sección es una única
-- sentencia, salvo POST-B que es un bloque transaccional de simulación
-- (termina en ROLLBACK: no escribe nada).
-- ============================================================================

-- ── PRE ─────────────────────────────────────────────────────────────────────

select * from (
  select 1 as orden, 'tabla de excepciones previa' as control, count(*)::text as resultado, '0' as esperado
    from information_schema.tables
   where table_schema = 'public' and table_name = 'nocturnidad_empleado_objetivo'
  union all
  select 2, 'novedades con tipo ajuste_nocturnidad previas', count(*)::text, '0'
    from public.novedades_laborales where tipo = 'ajuste_nocturnidad'
) v order by orden;

-- ── POST-A: estructura y políticas ──────────────────────────────────────────

select * from (
  select 1 as orden, 'tabla de excepciones creada' as control, count(*)::text as resultado, '1' as esperado
    from information_schema.tables
   where table_schema = 'public' and table_name = 'nocturnidad_empleado_objetivo'
  union all
  select 2, 'políticas de la tabla (una sola, admin para todo)',
         coalesce(string_agg(policyname || ' [' || cmd || ']', ' ;; '), '(ninguna)'),
         'Solo admin usa excepciones de nocturnidad [ALL]'
    from pg_policies
   where schemaname = 'public' and tablename = 'nocturnidad_empleado_objetivo'
  union all
  select 3, 'ninguna política con qual=true en la tabla', count(*)::text, '0'
    from pg_policies
   where schemaname = 'public' and tablename = 'nocturnidad_empleado_objetivo'
     and qual = 'true'
  union all
  select 4, 'CHECK del tipo admite ajuste_nocturnidad',
         case when pg_get_constraintdef((select oid from pg_constraint where conname = 'novedades_laborales_tipo_check')) like '%ajuste_nocturnidad%' then 'si' else 'NO' end,
         'si'
  union all
  select 5, 'ajuste sin horas queda prohibido (constraint presente)', count(*)::text, '1'
    from pg_constraint where conname = 'novedades_laborales_ajuste_nocturnidad_horas'
) v order by orden;

-- ── POST-B: simulación de vigilador autenticado (no persiste nada) ──────────
-- Toma un vigilador activo real y consulta la tabla con su identidad: la RLS
-- debe devolver CERO filas aunque existan excepciones cargadas. El bloque
-- termina en ROLLBACK.

begin;
select set_config('request.jwt.claims',
         json_build_object(
           'sub',  (select auth_user_id::text
                      from public.usuarios
                     where rol in ('guardia', 'vigilador')
                       and estado = 'activo'
                       and auth_user_id is not null
                     limit 1),
           'role', 'authenticated'
         )::text, true);
set local role authenticated;
select 'vigilador autenticado lista excepciones' as control,
       count(*)::text as resultado,
       '0 (siempre, aunque existan filas)' as esperado
  from public.nocturnidad_empleado_objetivo;
rollback;

-- ── POST-C: simulación de admin (misma mecánica; debe poder leer) ───────────

begin;
select set_config('request.jwt.claims',
         json_build_object(
           'sub',  (select auth_user_id::text
                      from public.usuarios
                     where rol = 'admin' and estado = 'activo'
                       and auth_user_id is not null
                     limit 1),
           'role', 'authenticated'
         )::text, true);
set local role authenticated;
select 'admin autenticado lista excepciones' as control,
       count(*)::text as resultado,
       'igual al total real de filas' as esperado
  from public.nocturnidad_empleado_objetivo;
rollback;
