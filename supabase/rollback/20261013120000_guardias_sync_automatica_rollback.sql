-- Rollback de 20261013120000_guardias_sync_automatica.
--
-- Quita las RPC de sincronización automática (la pantalla degrada sola al
-- flujo anterior de revisión manual). Los PERMISOS RESTRICTIVOS de las reglas
-- SE CONSERVAN: un rollback nunca restaura una política insegura (revisión
-- JC 13/10, punto 4) — la edición de la programación general queda en
-- jefatura (jefe de supervisores, dirección operativa, administración,
-- gerencia) también después de revertir.
-- El calendario y su auditoría no se tocan: lo ya sincronizado queda.

begin;

drop function if exists public.guardar_regla_sincronizada(uuid, jsonb);
drop function if exists public.sincronizar_regla_guardias(uuid, boolean);
drop function if exists public.sincronizar_regla_guardias(uuid);

-- Garantía de que las políticas restrictivas existen aunque este rollback se
-- corra sobre un estado raro (idempotente):
alter table public.supervisor_guardia_reglas enable row level security;
drop policy if exists supervisor_guardia_reglas_operador on public.supervisor_guardia_reglas;

drop policy if exists reglas_select_operador on public.supervisor_guardia_reglas;
create policy reglas_select_operador on public.supervisor_guardia_reglas
  for select to authenticated using (public.es_operador_actual());

drop policy if exists reglas_write_jefatura on public.supervisor_guardia_reglas;
create policy reglas_write_jefatura on public.supervisor_guardia_reglas
  for all to authenticated
  using (public.puede_gestionar_guardias_actual())
  with check (public.puede_gestionar_guardias_actual());

commit;

notify pgrst, 'reload schema';
