-- ============================================================================
-- Nivel nuevo del canal WhatsApp: escalamiento_wa_resuelto
-- (Pedido JC 10/11/2026: avisar por WhatsApp cuando una alerta de puesto
--  descubierto queda resuelta, diciendo cómo se resolvió y si hubo novedad.)
--
-- La tabla escalamiento_whatsapp_envios restringe `nivel` por CHECK. El aviso
-- de cierre usa la misma infraestructura (reclamo atómico, acuses, topes) y
-- por lo tanto el mismo registro: sólo hace falta admitir el nivel nuevo.
-- Nada más cambia: ni políticas, ni datos, ni el resto del CHECK.
--
-- Plantilla de Meta: puesto_descubierto_resuelto (es_AR, 7 variables),
-- APROBADA el 10/11/2026.
--
-- ROLLBACK: supabase/rollback/20261209120000_escalamiento_nivel_resuelto_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

alter table public.escalamiento_whatsapp_envios
  drop constraint if exists escalamiento_envios_nivel_check;

alter table public.escalamiento_whatsapp_envios
  add constraint escalamiento_envios_nivel_check check (nivel = any (array[
    'escalamiento_wa_15'::text,
    'escalamiento_wa_30'::text,
    'escalamiento_wa_ronda_no_iniciada'::text,
    'wa_ronda_pendiente_vigilador'::text,
    'escalamiento_wa_resuelto'::text
  ]));

commit;
