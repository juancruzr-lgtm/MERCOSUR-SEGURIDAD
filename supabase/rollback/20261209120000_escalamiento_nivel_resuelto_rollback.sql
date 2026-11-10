-- Rollback de 20261209120000_escalamiento_nivel_resuelto.
--
-- Restaura el CHECK anterior de `nivel`. OJO: si ya existen filas con
-- nivel = 'escalamiento_wa_resuelto', el ADD CONSTRAINT va a fallar — primero
-- hay que decidir qué hacer con esas filas (son auditoría de avisos ya
-- enviados; lo razonable es NO revertir esta migración y apagar el envío
-- desplegando el código anterior). El rollback existe para el caso de
-- reversión inmediata, antes de que el nivel se use.

begin;

alter table public.escalamiento_whatsapp_envios
  drop constraint if exists escalamiento_envios_nivel_check;

alter table public.escalamiento_whatsapp_envios
  add constraint escalamiento_envios_nivel_check check (nivel = any (array[
    'escalamiento_wa_15'::text,
    'escalamiento_wa_30'::text,
    'escalamiento_wa_ronda_no_iniciada'::text,
    'wa_ronda_pendiente_vigilador'::text
  ]));

commit;
