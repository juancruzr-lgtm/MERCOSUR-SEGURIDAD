-- ============================================================================
-- LIQ2G/B — 000 DÍAS TRABAJADOS: dato mensual explícito y editable por persona
-- ============================================================================
-- Se saca la regla incorrecta 000 = jornadas operativas (en código). El 000 pasa
-- a ser un dato por (período, persona), editable. Sin valor y persona exportable
-- -> pendiente que BLOQUEA el XLS para esa persona (lo hace el generador). No se
-- inventa fórmula; queda la puerta abierta a automatizar cuando se demuestre.
--
-- ROLLBACK: supabase/rollback/20260908233000_liq2g_dias_rollback.sql
-- ============================================================================

create table if not exists public.liquidacion_dias (
  id          uuid primary key default gen_random_uuid(),
  periodo_id  uuid not null references public.liquidacion_periodo(id) on delete cascade,
  persona_id  uuid not null references public.liquidacion_persona(id) on delete cascade,
  dias        numeric,
  origen      text not null default 'manual',   -- manual | importado
  created_by  uuid references public.usuarios(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (periodo_id, persona_id)
);
create index if not exists ix_liq_dias_periodo on public.liquidacion_dias (periodo_id);

alter table public.liquidacion_dias enable row level security;
revoke all on public.liquidacion_dias from anon;
drop policy if exists liquidacion_dias_gerencia on public.liquidacion_dias;
create policy liquidacion_dias_gerencia on public.liquidacion_dias
  for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());
