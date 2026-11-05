-- Rollback de 20261207100000. Revertir ANTES el paso B (20261207100100) si estaba
-- aplicado: sin esta RPC y con la columna revocada, nadie lee el CBU desde la app.
begin;
drop function if exists public.usuarios_cuentas_bancarias();
commit;
