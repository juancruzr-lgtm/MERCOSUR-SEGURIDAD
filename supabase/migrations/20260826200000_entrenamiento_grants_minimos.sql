-- entrenamiento_operativo: dejar SOLO los privilegios que la tabla necesita.
--
-- QUE SE ENCONTRO
-- Al auditar los grants en produccion, `authenticated` tenia sobre la tabla
-- recien creada:
--
--   INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
-- La migracion que la creo solo concedio SELECT, INSERT y UPDATE. Los otros
-- cuatro llegaron por los DEFAULT PRIVILEGES del esquema, que aplican a toda
-- tabla nueva. Es decir: no alcanza con conceder poco, hay que revocar lo que
-- se concede solo.
--
-- POR QUE IMPORTA, Y POR QUE NO ES UNA EMERGENCIA
-- La LECTURA ya estaba bien: RLS esta activa y la policy de select exige
-- entrenamiento_en_alcance(), que para un vigilador es false. Un vigilador que
-- consulte la tabla recibe cero filas, y esa es la propiedad que protege que no
-- vea su metrica. Eso no cambia.
--
-- DELETE si estaba cubierto por la policy `for all` —exige ia_es_admin()—, pero
-- TRUNCATE NO PASA POR RLS: es un privilegio de tabla y la seguridad de fila no
-- lo mira. PostgREST no expone TRUNCATE, asi que no habia una via real de
-- explotacion desde la app; aun asi, un privilegio que ninguna funcionalidad
-- usa y que ademas es el unico que puede saltarse RLS no tiene por que estar.
--
-- QUE QUEDA
--   authenticated  SELECT (filtrado por RLS), INSERT y UPDATE (filtrados por la
--                  policy, que exige admin). Nada mas.
--   service_role   sin cambios: es quien escribe desde la ruta de envio, y sus
--                  permisos no se tocan.

revoke delete, truncate, references, trigger
  on table public.entrenamiento_operativo from authenticated;

-- Idempotente y explicito: si alguien vuelve a correr la migracion anterior,
-- estas tres siguen siendo las unicas que hacen falta.
grant select, insert, update on table public.entrenamiento_operativo to authenticated;

revoke all on table public.entrenamiento_operativo from anon;

notify pgrst, 'reload schema';
