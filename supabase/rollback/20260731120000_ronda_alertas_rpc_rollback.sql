-- ROLLBACK de 20260731120000: elimina las RPCs de listado y resolución.
begin;
drop function if exists public.resolver_ronda_alerta(uuid, text, text);
drop function if exists public.listar_ronda_alertas_objetivo(uuid, text);
notify pgrst, 'reload schema';
commit;
