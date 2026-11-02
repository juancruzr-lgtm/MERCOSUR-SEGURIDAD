-- Rollback de 20261123120000_hoja_de_ruta_supervisores.sql
-- Quita las funciones. Conserva las tablas (registro de lo enviado y de la
-- configuración de Gerencia) en sólo lectura: nadie más escribe en ellas.
begin;

drop function if exists public.completar_hoja_ruta_envio(uuid, boolean, text, text, boolean);
drop function if exists public.reclamar_hoja_ruta_envio(jsonb);
drop function if exists public.hoja_ruta_guardar_destinatario(uuid, text, boolean);

revoke insert, update, delete on public.hoja_ruta_envios from service_role;
revoke insert, update, delete on public.hoja_ruta_destinatarios from service_role;

commit;
