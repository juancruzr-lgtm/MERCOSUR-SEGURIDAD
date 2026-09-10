-- ROLLBACK · SUELDO MENSUAL por usuario_id (20260910160000) → vuelve a persona_id (#211).
-- La tabla debe estar vacía para revertir sin pérdida.
begin;

do $$ begin
  if (select count(*) from public.liquidacion_sueldo_mensual) <> 0 then
    raise exception 'tabla no vacía: resolver antes de revertir';
  end if;
end $$;

drop function if exists public.set_sueldo_mensual(uuid, numeric, text);
drop function if exists public.sueldo_mensual_vigente(uuid, text);
drop table if exists public.liquidacion_sueldo_mensual;

create table public.liquidacion_sueldo_mensual (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.liquidacion_persona(id) on delete cascade,
  importe numeric not null check (importe >= 0),
  vigencia_desde date not null, vigencia_hasta date,
  created_at timestamptz not null default now(),
  created_by uuid references public.usuarios(id) on delete set null,
  constraint liq_sueldo_mensual_vigencia_coherente check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
create index ix_liq_sueldo_mensual_persona on public.liquidacion_sueldo_mensual (persona_id, vigencia_desde desc);
create unique index uq_liq_sueldo_mensual_vigente on public.liquidacion_sueldo_mensual (persona_id) where vigencia_hasta is null;
alter table public.liquidacion_sueldo_mensual enable row level security;
revoke all on public.liquidacion_sueldo_mensual from anon, authenticated;
grant select on public.liquidacion_sueldo_mensual to authenticated;
create policy liq_sueldo_mensual_lectura on public.liquidacion_sueldo_mensual
  for select to authenticated using (public.puede_liquidar_actual());
-- (RPCs persona_id no se re-crean acá; ver migración 20260910150000 si se necesitan.)

notify pgrst, 'reload schema';
commit;
