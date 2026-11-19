-- ═══════════════════════════════════════════════════════════════════════════
-- SIN APLICAR · requiere aprobación expresa de Gerencia
-- Permite registrar envíos de WhatsApp que no son de un turno (por ejemplo,
-- "objetivo nuevo sin protocolo ni rondas"), usando el mismo reclamo atómico,
-- topes y auditoría de escalamiento_whatsapp_envios.
--
-- Qué hace: turno_id deja de ser obligatorio. No cambia filas existentes ni
-- índices, no envía nada y no programa ningún cron.
-- Rollback: supabase/rollback/20261217120000_whatsapp_envios_sin_turno_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════
begin;
alter table public.escalamiento_whatsapp_envios alter column turno_id drop not null;
comment on column public.escalamiento_whatsapp_envios.turno_id is
  'Turno del evento. Null en avisos que no son de un turno (p. ej. wa_objetivo_sin_configurar).';
commit;
