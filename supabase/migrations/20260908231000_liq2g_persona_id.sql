-- ============================================================================
-- LIQ2G/A2 — persona_id en padrón y permanentes (transición desde usuarios)
-- ============================================================================
-- Se agrega persona_id (nullable) a las estructuras que dependían de usuarios y
-- se vuelve empleado_id nullable, manteniendo compatibilidad. Backfill del
-- persona_id desde el link usuario. GURUCHAR (sólo-Visual) recupera su 104.
--
-- ROLLBACK: supabase/rollback/20260908231000_liq2g_persona_id_rollback.sql
-- ============================================================================

-- Permanentes: persona_id + empleado_id nullable + backfill.
alter table public.liquidacion_concepto_permanente add column if not exists persona_id uuid references public.liquidacion_persona(id);
alter table public.liquidacion_concepto_permanente alter column empleado_id drop not null;
update public.liquidacion_concepto_permanente p
   set persona_id = pe.id from public.liquidacion_persona pe
 where pe.usuario_id = p.empleado_id and p.persona_id is null;

-- GURUCHAR: 104 Sindicato (no tiene usuario; se ancla por persona).
insert into public.liquidacion_concepto_permanente (persona_id, concepto_id, cantidad, importe, vigencia_desde, vigencia_hasta, motivo)
select pe.id, c.id, null, null, date '2026-08-01', null, 'padrón inicial auditado de Visual (ago-2026)'
from public.liquidacion_persona pe
join public.liquidacion_concepto_catalogo c on c.codigo_visual = '104'
where pe.cuil = '23142066599'
  and not exists (select 1 from public.liquidacion_concepto_permanente e where e.persona_id = pe.id and e.concepto_id = c.id and e.vigencia_desde = date '2026-08-01');

-- Padrón del período: persona_id + empleado_id nullable.
alter table public.liquidacion_periodo_empleado add column if not exists persona_id uuid references public.liquidacion_persona(id);
alter table public.liquidacion_periodo_empleado alter column empleado_id drop not null;
update public.liquidacion_periodo_empleado pe
   set persona_id = p.id from public.liquidacion_persona p
 where p.usuario_id = pe.empleado_id and pe.persona_id is null;
