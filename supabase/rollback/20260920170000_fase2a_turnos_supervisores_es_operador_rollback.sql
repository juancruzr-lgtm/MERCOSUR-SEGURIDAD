-- ROLLBACK de 20260920170000_fase2a_turnos_supervisores_es_operador.sql
-- Restaura las policies abiertas USING(true) (estado previo). OJO: eso reabre el
-- hueco (vigilador puede escribir turnos de supervisores).
begin;
drop policy if exists supervisores_guardia_operador on public.supervisores_guardia;
create policy "Admin acceso total supervisores guardia" on public.supervisores_guardia
  for all to public using (true);
drop policy if exists supervisor_guardia_reglas_operador on public.supervisor_guardia_reglas;
create policy "supervisor_guardia_reglas_autenticado" on public.supervisor_guardia_reglas
  for all to authenticated using (true) with check (true);
commit;
notify pgrst, 'reload schema';
