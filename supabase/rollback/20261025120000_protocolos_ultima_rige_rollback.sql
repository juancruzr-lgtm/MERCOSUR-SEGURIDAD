-- Rollback de 20261025120000_protocolos_ultima_rige.sql. Correr por separado.
-- Quita las dos funciones; las versiones que ya quedaron vigentes siguen vigentes
-- (son filas validas: se vuelve al circuito de aprobacion para las proximas).

begin;

drop function if exists public.protocolo_guardar(uuid, uuid, text, text, uuid);
drop function if exists public.protocolo_hacer_vigente(uuid);

notify pgrst, 'reload schema';

commit;
