-- Rollback de 20261013120000_guardias_sync_automatica.
-- Quita las RPC de sincronización automática y restaura la política anterior
-- de reglas (ALL para operador, como estaba antes de la orden del 13/10).
-- El calendario y su auditoría NO se tocan: lo ya sincronizado queda.

begin;

drop function if exists public.guardar_regla_sincronizada(uuid, jsonb);
drop function if exists public.sincronizar_regla_guardias(uuid);

drop policy if exists reglas_select_operador on public.supervisor_guardia_reglas;
drop policy if exists reglas_write_jefatura on public.supervisor_guardia_reglas;

create policy supervisor_guardia_reglas_operador on public.supervisor_guardia_reglas
  for all to authenticated
  using (public.es_operador_actual())
  with check (public.es_operador_actual());

commit;

notify pgrst, 'reload schema';
