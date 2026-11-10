-- ============================================================================
-- Facturación: plazo de pago de 30 días desde la emisión, salvo que el contrato diga otro
-- ============================================================================
-- Decisión de Gerencia (Juan Cruz, 10/11/2026): "que los contratos digan por defecto
-- 30 días si no tienen otro".
--
-- Al 10/11 ninguno de los 18 contratos tenía plazo (dias_vencimiento) ni evento de pago
-- (pago_evento). Por eso:
--   * la fecha de vencimiento que se informa a ARCA quedaba en la fecha de la prefactura
--     (plazo 0), y
--   * el vencimiento comercial decía "Condición comercial pendiente de definir".
--
-- Qué hace:
--   1. Contratos nuevos: dias_vencimiento = 30 y pago_evento = 'emision' por defecto.
--   2. Contratos existentes SIN plazo o SIN evento: 30 días desde la emisión. No se toca
--      ningún valor ya cargado; un contrato con fecha fija conserva su día del mes.
--   3. Cada contrato cambiado queda en fact_historial (condiciones_comerciales), con los
--      valores anteriores y el motivo.
-- La app aplica la misma regla si un contrato no tiene plazo (lib/facturacion/vto-arca.ts).
--
-- No toca prefacturas (su vencimiento aprobado no cambia) ni comprobantes.
-- Rollback: supabase/rollback/20261210110000_facturacion_plazo_pago_30_por_defecto_rollback.sql
-- ============================================================================

begin;

alter table public.fact_contratos alter column dias_vencimiento set default 30;
alter table public.fact_contratos alter column pago_evento set default 'emision';

with antes as (
  select id, dias_vencimiento, pago_evento
    from public.fact_contratos
   where pago_evento is null
      or (dias_vencimiento is null and pago_evento is distinct from 'fecha_fija')
     for update
), cambio as (
  update public.fact_contratos k set
    pago_evento = coalesce(k.pago_evento, 'emision'),
    dias_vencimiento = case when coalesce(k.pago_evento, 'emision') = 'fecha_fija' then k.dias_vencimiento
                            else coalesce(k.dias_vencimiento, 30) end,
    version = k.version + 1,
    updated_at = now()
  from antes a
  where k.id = a.id
  returning k.id, a.dias_vencimiento as dias_antes, a.pago_evento as evento_antes, k.dias_vencimiento, k.pago_evento
)
insert into public.fact_historial (entidad, entidad_id, accion, datos, por)
select 'contrato', c.id, 'condiciones_comerciales', jsonb_build_object(
    'nuevas', jsonb_build_object('dias_vencimiento', c.dias_vencimiento, 'pago_evento', c.pago_evento),
    'anteriores', jsonb_build_object('dias_vencimiento', c.dias_antes, 'pago_evento', c.evento_antes),
    'motivo', 'Plazo de pago por defecto: 30 días desde la emisión, para contratos sin otro plazo (Gerencia, 10/11/2026)',
    'migracion', '20261210110000'),
  null
from cambio c;

commit;
