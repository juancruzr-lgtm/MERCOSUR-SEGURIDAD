-- Rollback de 20261208100000_fichaje_solo_activos.sql
-- Vuelve a dejar que un usuario inactivo con cuenta fiche (situación anterior).
-- No restaura la política muerta "guardias_insertan_asistencia" (nunca aplicaba)
-- ni el TRUNCATE (no lo usa la app).
begin;
drop policy if exists "fichaje_solo_activos_insert" on public.registros_asistencia;
drop policy if exists "fichaje_solo_activos_update" on public.registros_asistencia;
drop policy if exists "fichaje_borrar_solo_conduccion" on public.registros_asistencia;
drop policy if exists "evidencias_solo_activos_insert" on public.evidencias;
drop policy if exists "evidencias_solo_activos_update" on public.evidencias;
drop policy if exists "ingreso_evidencias_solo_activos" on storage.objects;
drop function if exists public.actor_activo_actual();
commit;
