-- ROLLBACK de 20260908110000_backfill_puesto_organizacional.sql
-- Devuelve a null el puesto de las filas que este backfill asignó, dejando la
-- columna intacta (para volver a asignar). NO toca usuarios.rol. Al ser todo
-- transitorio, nulear el puesto restaura el gobierno por fallback (lib/capacidades).
-- Si se quiere quitar la columna entera, usar el rollback de 20260908100000.
begin;

update public.usuarios
set puesto_organizacional = null
where id in (
  '3a8e3c04-f4f5-48c4-8830-73edccb73667', -- juan cruz romero
  '5a8e3f70-77ef-4f89-8332-b9878f32a293', -- Facundo Romero (ADM001)
  '3731aa27-ce78-4817-8faa-66ad1edfabaa', -- Rodolfo Romero
  '023769de-9e99-481a-9caa-c604ef56b14b', -- Aldo Monzón
  '7a401cb9-dbbc-45e6-9781-bbde62a66120', -- Carlos Acosta
  '251289de-c16c-4315-969c-c8ee574ff7c1', -- Sabino Aranda
  '0376b452-18c8-4ab3-a500-ecef810300aa', -- Walter Fulla
  '69493cc2-15d6-4618-893e-4a9b1d044df8', -- Sergio Martínez
  'a4084933-c7a8-41bf-9767-2148eb5833bb', -- Cristian Wilhjelm
  'a2cd1908-7e9d-4bf4-8407-ecf644e1f351', -- joel juarez
  '1384746c-0520-4ebe-8d7b-17788d833cba', -- Laura M
  'eecd4b5c-095d-4062-be10-25e78ea9f499'  -- Andrea Narvarte
);

-- Vigiladores asignados por regla (mismos criterios, ahora con puesto seteado).
update public.usuarios
set puesto_organizacional = null
where puesto_organizacional = 'vigilador'
  and estado = 'activo'
  and rol in ('guardia', 'vigilador')
  and es_prueba = false;

commit;
