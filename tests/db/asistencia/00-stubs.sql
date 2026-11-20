-- Dependencias mínimas que el snapshot recortado no trae (ver tests/db/README.md).

  create table if not exists public.liquidacion_periodo (
    id uuid primary key default gen_random_uuid(), mes text not null, estado text not null);
  -- FK viva de producción que el recorte omite (liquidacion_periodo no está en el snapshot).
  -- NOT VALID: el seed usa un periodo_id ficticio sin fila.
  alter table public.liquidacion_auditoria add constraint liquidacion_auditoria_periodo_id_fkey
    foreign key (periodo_id) references public.liquidacion_periodo(id) on delete cascade not valid;
  create table if not exists public.objetivos_auditoria (
    id uuid primary key default gen_random_uuid(), objetivo_id uuid not null,
    campo text, created_at timestamptz not null default now(),
    constraint objetivos_auditoria_objetivo_id_fkey foreign key (objetivo_id) references public.objetivos(id) on delete cascade);
  alter table public.objetivos_auditoria enable row level security;
  grant select on public.objetivos_auditoria to authenticated;
  -- definición viva (20/11/2026)
  create or replace function public.legajo_puede_gestionar() returns boolean language sql stable security definer
    set search_path to 'public', 'pg_catalog' as $f$
    select auth.uid() is not null
       and (exists (select 1 from public.usuarios u
                    where u.auth_user_id = auth.uid() and u.estado = 'activo'
                      and u.puesto_organizacional in ('administracion','gerencia'))
            or coalesce(public.tiene_delegacion_gerencia_actual(), false))
  $f$;
  grant execute on function public.legajo_puede_gestionar() to authenticated;
  -- pg_net de mentira: registra a qué URL se llamó.
  create schema if not exists net;
  create table if not exists net.llamadas (url text, headers jsonb);
  create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', params jsonb default '{}', timeout_milliseconds int default 1000)
    returns bigint language plpgsql as $f$ begin insert into net.llamadas values (url, headers); return 1; end $f$;
  -- calcular_horas_reconocidas no está en el recorte: stub (sólo se usa con
  -- p_reconocer_fuera_de_turno, que estas pruebas no ejercitan; el plan de la CASE la exige).
  create or replace function public.calcular_horas_reconocidas(time, time, time, time) returns numeric
    language sql immutable as $f$ select public.calcular_horas_liquidables($1, $2, $3, $4) $f$;

