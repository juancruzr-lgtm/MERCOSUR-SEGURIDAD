-- ============================================================================
-- LIQ · Rodolfo Romero al padrón liquidable con IDENTIDAD VISUAL PENDIENTE
-- ============================================================================
-- ROLLBACK: supabase/rollback/20260909210000_liq_padron_rodolfo_pendiente_rollback.sql
--
-- Decisión JC (09/09/2026): Rodolfo (dirección operativa → BLOQUE 3) es
-- liquidable, pero NO tiene CUIL ni COD_INTERNO de Visual todavía. Se lo
-- incorpora al padrón como ACTIVO con cuil/cod_interno en NULL (identidad
-- PENDIENTE, sin inventar datos), para que la prevalidación lo marque como
-- IDENTIDAD VISUAL FALTANTE hasta que se carguen sus datos reales.
-- Idempotente: no duplica si ya existe la persona de ese usuario.
-- ============================================================================

insert into public.liquidacion_persona (usuario_id, nombre, cuil, cod_interno, estado_liquidable, motivo)
select u.id, 'Rodolfo Romero', null, null, 'activo',
       'Jerárquico BLOQUE 3 — identidad Visual (CUIL/COD_INTERNO) PENDIENTE de carga (JC 09/09/2026)'
from public.usuarios u
where lower(u.apellido) = 'romero' and lower(u.nombre) = 'rodolfo' and u.estado = 'activo'
  and not exists (select 1 from public.liquidacion_persona lp where lp.usuario_id = u.id);
