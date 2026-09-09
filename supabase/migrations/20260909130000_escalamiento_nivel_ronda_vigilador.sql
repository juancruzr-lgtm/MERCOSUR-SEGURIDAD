-- Auditoria de WhatsApp: aceptar el nivel del refuerzo al VIGILADOR por ronda.
--
-- El endpoint /api/push/ronda-vigilador-whatsapp reutiliza la tabla de
-- auditoria escalamiento_whatsapp_envios (misma forma: turno, objetivo,
-- guardia, telefono, plantilla, resultado, id_proveedor). Solo falta permitir
-- el nuevo valor de `nivel`. No toca datos ni el escalamiento a supervisores.

begin;

alter table public.escalamiento_whatsapp_envios
  drop constraint if exists escalamiento_envios_nivel_check;

alter table public.escalamiento_whatsapp_envios
  add constraint escalamiento_envios_nivel_check
  check (nivel in (
    'escalamiento_wa_15',
    'escalamiento_wa_30',
    'escalamiento_wa_ronda_no_iniciada',
    'wa_ronda_pendiente_vigilador'
  ));

notify pgrst, 'reload schema';

commit;
