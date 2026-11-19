-- Rollback de 20261216110000_ultima_supervision_permiso_por_objetivo.sql
-- Vuelve EXACTAMENTE a la versión de 20261113120000 (SECURITY INVOKER; la RLS
-- de supervisiones decide qué filas entran). No toca datos.
begin;

create or replace function public.ultima_supervision_por_objetivo()
returns table (objetivo_id uuid, ultima_at timestamptz)
language sql stable security invoker
set search_path = public, pg_catalog as $$
  select s.objetivo_id, max(s.created_at)
    from public.supervisiones s
   where s.estado <> 'incompleta'
   group by s.objetivo_id
$$;

comment on function public.ultima_supervision_por_objetivo() is null;

revoke all on function public.ultima_supervision_por_objetivo() from public, anon;
grant execute on function public.ultima_supervision_por_objetivo() to authenticated, service_role;

commit;
