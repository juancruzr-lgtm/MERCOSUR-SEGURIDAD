-- ============================================================================
-- LIQ3/F3 — Resultado final de Visual (versionado) + enviado (trazabilidad)
-- ============================================================================
-- Trazabilidad completa: operativo → ajuste → ENVIADO a Visual → RESULTADO Visual.
-- El resultado NO es input de preparación: es el valor salarial FINAL. El Neto de
-- Visual es la referencia; MERCOSUR NO lo recalcula. Reimportar una Planilla
-- General corregida crea una VERSIÓN nueva (no sobrescribe): se marca la vigente.
-- RLS: puede_liquidar_actual() (Administración + Gerencia).
--
-- ROLLBACK: supabase/rollback/20260909120000_liq3_resultado_visual_rollback.sql
-- ============================================================================

-- Qué mandó MERCOSUR a Visual (snapshot al generar el .xls).
create table if not exists public.liquidacion_enviado_visual (
  id          uuid primary key default gen_random_uuid(),
  periodo_id  uuid not null references public.liquidacion_periodo(id) on delete cascade,
  cuil        text,
  cod_interno text,
  codigo      text not null,
  cantidad    numeric,
  importe     numeric,
  enviado_at  timestamptz not null default now(),
  unique (periodo_id, cuil, codigo)
);
create index if not exists ix_liq_enviado_periodo on public.liquidacion_enviado_visual (periodo_id);

-- Resultado de Visual: cabecera por VERSIÓN.
create table if not exists public.liquidacion_resultado_visual (
  id            uuid primary key default gen_random_uuid(),
  periodo_id    uuid not null references public.liquidacion_periodo(id) on delete cascade,
  version       integer not null,
  archivo       text,
  hash          text not null,
  vigente       boolean not null default true,
  importado_por uuid references public.usuarios(id),
  importado_at  timestamptz not null default now(),
  unique (periodo_id, version),
  unique (periodo_id, hash)
);
create index if not exists ix_liq_resultado_periodo on public.liquidacion_resultado_visual (periodo_id);

-- Totales por empleado del resultado (Neto = Imponible + No Imp + Asig − Desc, CONTROL).
create table if not exists public.liquidacion_resultado_fila (
  id            uuid primary key default gen_random_uuid(),
  resultado_id  uuid not null references public.liquidacion_resultado_visual(id) on delete cascade,
  cuil          text,
  legajo        text,
  nombre        text,
  imponible     numeric,
  no_imponible  numeric,
  asignaciones  numeric,
  descuentos    numeric,
  neto          numeric
);
create index if not exists ix_liq_resultado_fila on public.liquidacion_resultado_fila (resultado_id);

-- Conceptos finales del resultado.
create table if not exists public.liquidacion_resultado_concepto (
  id           uuid primary key default gen_random_uuid(),
  resultado_id uuid not null references public.liquidacion_resultado_visual(id) on delete cascade,
  cuil         text,
  codigo       text,
  nombre       text,
  cantidad     numeric,
  importe      numeric
);
create index if not exists ix_liq_resultado_concepto on public.liquidacion_resultado_concepto (resultado_id);

do $$
declare t text;
begin
  foreach t in array array['liquidacion_enviado_visual','liquidacion_resultado_visual','liquidacion_resultado_fila','liquidacion_resultado_concepto'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t||'_liq', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.puede_liquidar_actual()) with check (public.puede_liquidar_actual())', t||'_liq', t);
  end loop;
end $$;
