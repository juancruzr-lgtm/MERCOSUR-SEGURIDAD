-- Verificación posterior a 20261217120000. Sólo lectura.
-- 1. turno_id admite null (is_nullable = YES)
select is_nullable from information_schema.columns where table_name = 'escalamiento_whatsapp_envios' and column_name = 'turno_id';
-- 2. Ningún envío del aviso nuevo todavía (0 filas mientras siga apagado)
select count(*) from public.escalamiento_whatsapp_envios where nivel = 'wa_objetivo_sin_configurar';
