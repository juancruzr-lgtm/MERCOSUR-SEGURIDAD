-- Rollback de 20261008190000_guardias_permisos_auditoria.
-- Restaura la política amplia anterior (ALL para es_operador_actual) y quita
-- trigger, RPC y helpers. La tabla de auditoría y updated_at se CONSERVAN
-- (son historial; borrarlos destruiría registro — hacerlo a mano sólo si JC
-- lo pide expresamente).

begin;

drop trigger if exists trg_auditar_supervisores_guardia on public.supervisores_guardia;
drop function if exists public.tg_auditar_supervisores_guardia();

drop trigger if exists trg_touch_supervisor_guardia_reglas on public.supervisor_guardia_reglas;
drop function if exists public.tg_touch_supervisor_guardia_reglas();

drop function if exists public.guardia_excepcion_supervisor(text, uuid, jsonb, text);

drop policy if exists supervisores_guardia_select_alcance  on public.supervisores_guardia;
drop policy if exists supervisores_guardia_insert_jefatura on public.supervisores_guardia;
drop policy if exists supervisores_guardia_update_jefatura on public.supervisores_guardia;

create policy supervisores_guardia_operador on public.supervisores_guardia
  for all to authenticated
  using (public.es_operador_actual())
  with check (public.es_operador_actual());

drop function if exists public.es_zona_de_supervisor_actual(text);
drop function if exists public.puede_gestionar_guardias_actual();

commit;

notify pgrst, 'reload schema';
