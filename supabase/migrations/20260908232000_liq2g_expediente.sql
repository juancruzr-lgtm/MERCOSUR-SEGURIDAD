-- ============================================================================
-- LIQ2G/C — Expedientes/embargos de importe (mapeo a slots Visual 111/993)
-- ============================================================================
-- El objeto de negocio es el EXPEDIENTE de la persona (no 2 conceptos fijos).
-- 111 y 993 son SLOTS de exportación: 1º expediente vigente -> 111, 2º -> 993.
-- >2 simultáneos -> bloquear/alertar (lo hace el generador). Importes NO eternos:
-- vigencia desde/hasta. 104/977/48410 quedan como permanentes calculados 0/0.
--
-- ROLLBACK: supabase/rollback/20260908232000_liq2g_expediente_rollback.sql
-- ============================================================================

create table if not exists public.liquidacion_expediente (
  id             uuid primary key default gen_random_uuid(),
  persona_id     uuid not null references public.liquidacion_persona(id) on delete cascade,
  referencia     text,
  observacion    text,
  importe        numeric,
  vigencia_desde date not null,
  vigencia_hasta date,
  estado         text not null default 'activo' check (estado in ('activo','baja')),
  slot_preferido text check (slot_preferido in ('111','993')),  -- preserva asignación previa
  origen         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (vigencia_hasta is null or vigencia_hasta >= vigencia_desde)
);
create index if not exists ix_liq_expediente_persona on public.liquidacion_expediente (persona_id);

alter table public.liquidacion_expediente enable row level security;
revoke all on public.liquidacion_expediente from anon;
drop policy if exists liquidacion_expediente_gerencia on public.liquidacion_expediente;
create policy liquidacion_expediente_gerencia on public.liquidacion_expediente
  for all to authenticated using (public.es_gerencia_actual()) with check (public.es_gerencia_actual());

-- Migrar los 2 casos de agosto de OVEJERO (111/993) a expedientes, preservando
-- importes como estado inicial (NO como valores eternos) y el slot previo.
insert into public.liquidacion_expediente (persona_id, referencia, observacion, importe, vigencia_desde, estado, slot_preferido, origen)
select pe.id, 'Expediente 111', 'Migrado del permanente 111 (ago-2026)', p.importe, date '2026-08-01', 'activo', '111', 'padron_visual'
from public.liquidacion_concepto_permanente p
join public.liquidacion_persona pe on pe.id = p.persona_id
join public.liquidacion_concepto_catalogo c on c.id = p.concepto_id
where c.codigo_visual = '111' and pe.cuil = '20247729187';

insert into public.liquidacion_expediente (persona_id, referencia, observacion, importe, vigencia_desde, estado, slot_preferido, origen)
select pe.id, 'Embargo suma fija 993', 'Migrado del permanente 993 (ago-2026)', p.importe, date '2026-08-01', 'activo', '993', 'padron_visual'
from public.liquidacion_concepto_permanente p
join public.liquidacion_persona pe on pe.id = p.persona_id
join public.liquidacion_concepto_catalogo c on c.id = p.concepto_id
where c.codigo_visual = '993' and pe.cuil = '20247729187';

-- Los 111/993 dejan de ser permanentes de código fijo.
delete from public.liquidacion_concepto_permanente p
 using public.liquidacion_concepto_catalogo c
 where p.concepto_id = c.id and c.codigo_visual in ('111','993');
