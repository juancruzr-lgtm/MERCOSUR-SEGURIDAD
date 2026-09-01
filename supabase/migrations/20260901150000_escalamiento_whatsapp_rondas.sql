-- WhatsApp de rondas no iniciadas: la auditoria acepta el nuevo nivel y
-- referencia la alerta real.
--
-- QUE NO SE CREA
-- Ni detector ni tabla de deduplicacion: el hecho vive en ronda_alertas
-- (evaluar_ronda_alertas() via pg_cron) y la deduplicacion reutiliza
-- notificaciones_enviadas con el tipo 'escalamiento_wa_ronda_no_iniciada:<id>'
-- sobre la clave (usuario, objetivo, tipo) que ya usa el push de rondas.
--
-- Esta migracion solo toca la tabla de AUDITORIA de envios WhatsApp:
--   1. agrega ronda_alerta_id para poder reconstruir que alerta disparo cada
--      mensaje (en puestos ese rol lo cumple turno_id + nivel);
--   2. amplia el check de nivel al valor de ronda.
--
-- Debe aplicarse ANTES de habilitar envios reales de ronda: el dry-run no
-- escribe auditoria y no la necesita.

begin;

alter table public.escalamiento_whatsapp_envios
  add column if not exists ronda_alerta_id uuid
    references public.ronda_alertas(id) on delete set null;

alter table public.escalamiento_whatsapp_envios
  drop constraint if exists escalamiento_envios_nivel_check;

alter table public.escalamiento_whatsapp_envios
  add constraint escalamiento_envios_nivel_check
  check (nivel in (
    'escalamiento_wa_15',
    'escalamiento_wa_30',
    'escalamiento_wa_ronda_no_iniciada'
  ));

create index if not exists escalamiento_envios_ronda_alerta_idx
  on public.escalamiento_whatsapp_envios (ronda_alerta_id)
  where ronda_alerta_id is not null;

notify pgrst, 'reload schema';

commit;
