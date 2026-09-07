-- Verificación PRE/POST de 20260907150000_usuarios_es_prueba.sql
--
-- PRE (antes de aplicar): la columna no existe.
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'usuarios'
--      and column_name = 'es_prueba';
--   → 0 filas
--
-- POST (después de aplicar):
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios'
      and column_name = 'es_prueba')                                  as columna_existe,   -- esperado: 1
  (select count(*) from public.usuarios where es_prueba)              as cuentas_de_prueba, -- esperado: 1
  (select count(*) from public.usuarios where es_prueba and id = 'e1276080-4b04-4586-af7a-b5547588531b')
                                                                      as es_la_de_juan;     -- esperado: 1
