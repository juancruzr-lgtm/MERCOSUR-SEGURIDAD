-- Rollback de 20261113120000_supervision_exigibilidad_servicio.sql
--
-- Vuelve evaluacion_vencimientos_supervision a la definición de producción al
-- 02/11/2026 (pg_get_functiondef; igual a 20261028120000) y quita lo nuevo.
--
-- OJO: borra objetivo_suspensiones y las columnas de fechas de servicio. Si ya
-- se cargaron datos, exportarlos antes:
--   select * from public.objetivo_suspensiones;
--   select id, nombre, fecha_inicio_servicio, fecha_fin_servicio from public.objetivos
--    where fecha_inicio_servicio is not null or fecha_fin_servicio is not null;
-- Las filas de objetivos_auditoria con campo fecha_*_servicio se conservan.
-- La app sigue funcionando sin la migración (lee con tolerancia y cae al
-- paginado si falta la RPC).

begin;

create or replace function public.evaluacion_vencimientos_supervision(p_desde date, p_hasta date)
returns table (
  objetivo_id     uuid,
  supervisor_id   uuid,
  vencio_at       timestamptz,
  regularizado_at timestamptz,
  horas_vencido   numeric
)
language sql stable security definer
set search_path = public, pg_catalog as $$
  with params as (
    select (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires') as t0,
           least(now(), (p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires') as t1
  ),
  sup as (
    select s.objetivo_id, s.created_at,
           lead(s.created_at) over (partition by s.objetivo_id order by s.created_at) as siguiente
      from public.supervisiones s
     where s.estado <> 'incompleta'
  ),
  venc as (
    select o.id as objetivo_id, o.zona_id,
           s.created_at + make_interval(hours => o.frecuencia_supervision_horas) as vencio_at,
           s.siguiente as regularizado_at
      from sup s
      join public.objetivos o on o.id = s.objetivo_id
     where o.estado = 'activo' and coalesce(o.es_prueba, false) = false
       and o.frecuencia_supervision_horas is not null
       and coalesce(s.siguiente, now()) > s.created_at + make_interval(hours => o.frecuencia_supervision_horas)
  )
  select v.objetivo_id, r.supervisor_id, v.vencio_at, v.regularizado_at,
         round((extract(epoch from least(coalesce(v.regularizado_at, p.t1), p.t1)
                                  - greatest(v.vencio_at, p.t0)) / 3600.0)::numeric, 1)
    from venc v
    cross join params p
    cross join lateral public.responsables_supervision_en(v.zona_id, greatest(v.vencio_at, p.t0)) r
   where v.vencio_at < p.t1
     and coalesce(v.regularizado_at, now()) > p.t0
     and exists (select 1 from public.turnos t
                  where t.objetivo_id = v.objetivo_id
                    and t.fecha between (greatest(v.vencio_at, p.t0) at time zone 'America/Argentina/Buenos_Aires')::date
                                    and (least(coalesce(v.regularizado_at, p.t1), p.t1) at time zone 'America/Argentina/Buenos_Aires')::date)
$$;
revoke all on function public.evaluacion_vencimientos_supervision(date, date) from public, anon, authenticated;

drop function if exists public.ultima_supervision_por_objetivo();
drop index if exists public.supervisiones_objetivo_valida_idx;
drop function if exists public.objetivo_tramos_exigibles(uuid, timestamptz, timestamptz);
drop function if exists public.objetivo_exigible_en(uuid, timestamptz);
drop function if exists public.objetivo_estado_en(uuid, timestamptz);

drop table if exists public.objetivo_suspensiones;
drop function if exists public.objetivo_suspensiones_identidad();

drop trigger if exists trg_objetivos_fechas_servicio on public.objetivos;
drop function if exists public.objetivos_fechas_servicio_guardia();
alter table public.objetivos drop constraint if exists objetivos_fechas_servicio_orden;
alter table public.objetivos drop column if exists fecha_fin_servicio;
alter table public.objetivos drop column if exists fecha_inicio_servicio;
drop function if exists public.puede_gestionar_servicio_objetivo_actual();

commit;
