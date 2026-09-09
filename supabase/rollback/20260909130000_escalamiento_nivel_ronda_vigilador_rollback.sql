-- Rollback de 20260909130000_escalamiento_nivel_ronda_vigilador.sql
-- Vuelve el check de `nivel` a los tres valores previos (sin el refuerzo al
-- vigilador). Ejecutar SOLO manualmente si se decide revertir; requiere que no
-- queden filas con nivel = 'wa_ronda_pendiente_vigilador' (si las hay, borrarlas
-- o reasignarlas antes, porque el check las rechazaría).

begin;

alter table public.escalamiento_whatsapp_envios
  drop constraint if exists escalamiento_envios_nivel_check;

alter table public.escalamiento_whatsapp_envios
  add constraint escalamiento_envios_nivel_check
  check (nivel in (
    'escalamiento_wa_15',
    'escalamiento_wa_30',
    'escalamiento_wa_ronda_no_iniciada'
  ));

notify pgrst, 'reload schema';

commit;
