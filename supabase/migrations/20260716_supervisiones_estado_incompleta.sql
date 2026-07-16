-- Agrega 'incompleta' como estado válido de supervisión.
--
-- Una supervisión incompleta se genera cuando el supervisor guarda
-- sin haber respondido todos los ítems obligatorios del checklist.
-- No se bloquea el guardado: se preserva la supervisión con las
-- respuestas disponibles y se indica qué quedó pendiente.
--
-- Idempotente: el DROP/ADD solo actúa si el constraint existe con
-- el nombre exacto definido en la migración original.

do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'supervisiones_estado_check'
  ) then
    alter table supervisiones drop constraint supervisiones_estado_check;
  end if;
end $$;

alter table supervisiones
  add constraint supervisiones_estado_check
  check (estado in ('ok', 'con_observacion', 'critico', 'incompleta'));
