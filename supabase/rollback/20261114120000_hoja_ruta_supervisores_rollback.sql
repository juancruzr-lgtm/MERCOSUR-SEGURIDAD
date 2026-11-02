-- ROLLBACK de 20261114120000_hoja_ruta_supervisores.sql
-- Fuerza el modo 'desactivado' (si existiera el cron, deja de enviar) y quita
-- RPC y vistas. Las tablas se CONSERVAN: son evidencia de lo generado y enviado.
begin;
update public.app_config set value = 'desactivado' where key = 'hoja_ruta_modo';
drop function if exists public.hoja_ruta_destinatario_guardar(uuid, boolean, text, text);
drop function if exists public.hoja_ruta_recorrido(uuid);
drop function if exists public.hoja_ruta_puntos_guardia(uuid);
drop view if exists public.hoja_ruta_destinatario_estado;
drop view if exists public.hoja_ruta_envios_estado;
notify pgrst, 'reload schema';
commit;
