-- Rollback de 20261011130000 (visor del archivo histórico).
-- ANTES: vaciar el bucket legajo-historico-temporal (las copias temporales ya
-- vencen solas a los 10 minutos) y detener el lector de SRV02.
-- Quita funciones; las tablas de pedidos y aperturas se conservan como
-- registro (sólo service_role). Para quitarlas también, descomentar al final.
begin;
drop function if exists public.legajo_historico_solicitar_vista(uuid);
drop function if exists public.legajo_historico_estado_vista(uuid);
drop function if exists public.legajo_historico_abrir_vista(uuid, text, text);
drop function if exists public.legajo_historico_vista_tomar(text);
drop function if exists public.legajo_historico_vista_lista(uuid, text, text, bigint, text);
drop function if exists public.legajo_historico_vista_error(uuid, text);
drop function if exists public.legajo_historico_vistas_a_borrar();
drop function if exists public.legajo_historico_vista_borrada(uuid);
-- drop table if exists public.legajo_historico_vista_aperturas;  -- registro de auditoría
-- drop table if exists public.legajo_historico_vistas;
notify pgrst, 'reload schema';
commit;
