-- Rollback de 20261121120000_whatsapp_envios_reclamo_reintentos.sql
-- ANTES: revertir el código (las rutas llaman a reclamar_envio_whatsapp; sin la
-- función no envían nada — fail-closed — pero conviene volver al deploy previo).
-- Las columnas nuevas quedan (sin uso): no se pierde la auditoría registrada.
drop function if exists public.reclamar_envio_whatsapp(text, jsonb, integer, integer, integer, integer, timestamptz);
drop function if exists public.completar_envio_whatsapp(uuid, boolean, text, text, boolean, timestamptz);
drop index if exists public.escalamiento_envios_clave_intento_key;
drop index if exists public.escalamiento_envios_destinatario_fecha_idx;
