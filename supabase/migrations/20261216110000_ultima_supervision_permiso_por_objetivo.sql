-- ============================================================================
-- ultima_supervision_por_objetivo(): permiso por objetivo, no por fila
-- (seguimiento de la caída por Disk IO del 18/11/2026)
-- ============================================================================
-- ANTES (20261113120000): SECURITY INVOKER. Agrupa supervisiones por objetivo,
-- pero la RLS de `supervisiones` (supervisiones_alcance) corre FILA POR FILA:
-- alcanza_objetivo_actual(objetivo_id) para ~3.500 filas en cada llamada.
-- Medido en producción (MICRO): ~950–1.030 ms y ~16.000–20.600 buffers por
-- llamada; la llaman el Dashboard, Control de supervisiones y la app del
-- supervisor (~280 llamadas/día).
--
-- AHORA: SECURITY DEFINER que reproduce EXACTAMENTE lo que la RLS deja ver:
--   * acceso_bloqueado_baja (RESTRICTIVA): acceso_habilitado_actual()
--   * supervisiones_alcance (PERMISIVA):
--       alcanza_objetivo_actual(objetivo_id)
--       OR (es_operador_actual() AND supervisor_id = mi usuario)
--   * service_role (bypassrls antes): ve todo, igual que antes.
-- La primera rama se evalúa una vez por OBJETIVO (~50) sobre el máximo ya
-- agrupado; la segunda (supervisiones propias fuera de alcance) filtra por
-- supervisor_id, sin funciones por fila. El máximo final por objetivo combina
-- las dos ramas, que es lo mismo que el máximo sobre la unión de filas visibles.
--
-- Verificado en producción dentro de BEGIN/ROLLBACK, viejo vs nuevo, filas
-- idénticas (objetivo_id = ultima_at) para: admin (48 obj.), supervisor por
-- zonas (6), supervisor (1), supervisor con supervisiones propias fuera de su
-- alcance (41), usuario sin alcance (0) y service_role (48). 945 ms → 19 ms.
--
-- Firma, columnas de salida, search_path y permisos (EXECUTE para
-- authenticated y service_role; nada para anon/public) quedan iguales.
-- CREATE OR REPLACE conserva dueño y ACL; igual se re-aplican abajo.
--
-- Rollback: supabase/rollback/20261216110000_ultima_supervision_permiso_por_objetivo_rollback.sql
-- ============================================================================

begin;

create or replace function public.ultima_supervision_por_objetivo()
returns table (objetivo_id uuid, ultima_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  -- MATERIALIZED: evita que Postgres empuje el filtro de permiso por debajo
  -- del GROUP BY y lo vuelva a evaluar fila por fila.
  with yo as materialized (
    select (select auth.role()) = 'service_role'          as es_servicio,
           (select public.acceso_habilitado_actual())      as habilitado,
           (select public.es_operador_actual())            as operador
  ),
  por_objetivo as materialized (
    select s.objetivo_id, max(s.created_at) as ultima_at
      from public.supervisiones s
     where s.estado <> 'incompleta'
     group by s.objetivo_id
  ),
  visibles as (
    -- Rama 1: objetivos dentro del alcance (una evaluación por objetivo).
    select p.objetivo_id, p.ultima_at
      from por_objetivo p, yo
     where yo.es_servicio
        or (yo.habilitado and public.alcanza_objetivo_actual(p.objetivo_id))
    union all
    -- Rama 2: supervisiones propias del operador (aunque el objetivo esté
    -- fuera de su alcance), igual que la segunda mitad de supervisiones_alcance.
    select s.objetivo_id, max(s.created_at)
      from public.supervisiones s, yo
     where not yo.es_servicio
       and yo.habilitado
       and yo.operador
       and s.estado <> 'incompleta'
       and s.supervisor_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid())
     group by s.objetivo_id
  )
  select v.objetivo_id, max(v.ultima_at)
    from visibles v
   group by v.objetivo_id
$fn$;

comment on function public.ultima_supervision_por_objetivo() is
  'Última supervisión válida por objetivo, con el mismo alcance que la RLS de supervisiones; permiso evaluado por objetivo, no por fila (18/11/2026).';

revoke all on function public.ultima_supervision_por_objetivo() from public, anon;
grant execute on function public.ultima_supervision_por_objetivo() to authenticated, service_role;

commit;
