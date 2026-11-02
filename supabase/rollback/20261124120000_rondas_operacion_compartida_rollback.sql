-- Rollback de 20261124120000_rondas_operacion_compartida.sql
-- Vuelve a puede_administrar_rondas_objetivo en las 7 funciones y en las 8
-- políticas de lectura (nombres y condiciones como estaban en producción el
-- 02/11/2026). Conserva las columnas responsables_zona / fuera_de_zona con lo
-- ya registrado (historial).
begin;

do $do$
declare
  v_nombres constant text[] := array[
    'listar_ejecuciones_objetivo', 'listar_ejecuciones_en_curso_objetivo', 'listar_rondas_pausadas',
    'rondas_ejecucion_detalle_supervisor', 'listar_ronda_alertas_objetivo',
    'listar_rondas_programadas_objetivo', 'resolver_ronda_alerta'];
  v_oid oid;
  v_def text;
begin
  for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = any (v_nombres) loop
    v_def := pg_get_functiondef(v_oid);
    if position('puede_operar_rondas_objetivo(' in v_def) > 0 then
      execute replace(v_def, 'puede_operar_rondas_objetivo(', 'puede_administrar_rondas_objetivo(');
    end if;
  end loop;
end $do$;

drop policy if exists rondas_operar_lee_alertas on public.ronda_alertas;
create policy "Admin supervisor lee ronda_alertas de su alcance" on public.ronda_alertas
  for select using (public.puede_administrar_rondas_objetivo(objetivo_id));

drop policy if exists rondas_operar_lee_intervenciones on public.ronda_alerta_intervenciones;
create policy "Admin supervisor lee ronda_alerta_intervenciones de su alcance" on public.ronda_alerta_intervenciones
  for select using (exists (select 1 from public.ronda_alertas a
    where a.id = ronda_alerta_intervenciones.ronda_alerta_id and public.puede_administrar_rondas_objetivo(a.objetivo_id)));

drop policy if exists rondas_operar_lee_ejecuciones on public.ronda_ejecuciones;
create policy "Admin supervisor lee ejecuciones de su alcance" on public.ronda_ejecuciones
  for select using (public.puede_administrar_rondas_objetivo(objetivo_id));

drop policy if exists rondas_operar_lee_ejecucion_puntos on public.ronda_ejecucion_puntos;
create policy "Admin supervisor lee puntos de ejecucion de su alcance" on public.ronda_ejecucion_puntos
  for select using (exists (select 1 from public.ronda_ejecuciones e
    where e.id = ronda_ejecucion_puntos.ronda_ejecucion_id and public.puede_administrar_rondas_objetivo(e.objetivo_id)));

drop policy if exists rondas_operar_lee_pausas on public.ronda_pausas;
create policy "Lectura pausas para supervisores autorizados" on public.ronda_pausas
  for select using (public.puede_administrar_rondas_objetivo(objetivo_id));

drop policy if exists rondas_operar_lee_rondas on public.rondas_base;
create policy "Admin supervisor lee rondas de su alcance" on public.rondas_base
  for select using (public.puede_administrar_rondas_objetivo(objetivo_id));

drop policy if exists rondas_operar_lee_puntos on public.ronda_puntos;
create policy "Admin supervisor lee puntos de su alcance" on public.ronda_puntos
  for select using (exists (select 1 from public.rondas_base rb
    where rb.id = ronda_puntos.ronda_base_id and public.puede_administrar_rondas_objetivo(rb.objetivo_id)));

drop policy if exists rondas_operar_lee_horarios_sin_exigencia on public.ronda_horarios_sin_exigencia;
create policy "Rondas: horarios sin exigencia para quien administra la ronda" on public.ronda_horarios_sin_exigencia
  for select using (exists (select 1 from public.rondas_base rb
    where rb.id = ronda_horarios_sin_exigencia.ronda_base_id and public.puede_administrar_rondas_objetivo(rb.objetivo_id)));

drop trigger if exists ronda_intervencion_registrar_zona on public.ronda_alerta_intervenciones;
drop function if exists public.ronda_intervencion_registrar_zona();
drop function if exists public.puede_operar_rondas_objetivo(uuid);

commit;
