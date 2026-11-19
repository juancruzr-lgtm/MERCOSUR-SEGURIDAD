-- Rollback de 20261217120000. Falla a propósito si ya hay envíos sin turno:
-- en ese caso hay que decidir qué hacer con ellos antes de volver atrás.
begin;
do $$ begin
  if exists (select 1 from public.escalamiento_whatsapp_envios where turno_id is null) then
    raise exception 'Hay envíos sin turno registrados: no se puede volver a exigir turno_id';
  end if;
end $$;
alter table public.escalamiento_whatsapp_envios alter column turno_id set not null;
commit;
