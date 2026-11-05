-- Rollback de 20261207100100: vuelve al SELECT de tabla completo para authenticated
-- (estado anterior: la columna cuenta_bancaria vuelve a ser legible por REST para
-- quien ve la fila). Usar sólo si el paso B rompe algo; la exposición V2 reaparece.
begin;
revoke select on public.usuarios from authenticated;
grant select on public.usuarios to authenticated;
commit;
