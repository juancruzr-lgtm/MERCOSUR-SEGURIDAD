-- ROLLBACK de 20260801100000: quita la RPC de suspensión del vigilador.
-- Deja el tipo 'suspendida', la columna motivo_vigilador y el campo extra de
-- listar_ronda_alertas_objetivo (todos aditivos e inocuos); removerlos exigiría
-- manejar datos existentes, por eso solo se elimina la superficie invocable nueva.
begin;
drop function if exists public.suspender_ronda(uuid, text);
notify pgrst, 'reload schema';
commit;
