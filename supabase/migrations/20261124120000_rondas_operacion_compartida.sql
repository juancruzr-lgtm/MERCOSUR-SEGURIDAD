-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- Rondas: operación compartida entre supervisores (auditoría 10/2026, punto 4.3)
-- ============================================================================
-- Diseño: docs/auditoria-2026-10/rondas_operacion_compartida.md
-- Pruebas: supabase/pruebas/rondas-operacion-compartida/run.mjs (PGlite)
-- Rollback: supabase/rollback/20261124120000_rondas_operacion_compartida_rollback.sql
-- Aplicar DESPUÉS de 20261115120000 y 20261122120000 (reescribe las versiones
-- que esas dejan vivas).
--
-- Regla: todo supervisor autorizado puede VER e INTERVENIR las rondas de
-- cualquier objetivo. Las notificaciones siguen yendo sólo al responsable (no
-- se toca ningún aviso). Sin acceso a sueldos, documentación ni horas
-- liquidables (no se toca ninguna otra tabla ni función).
--
--  1) puede_operar_rondas_objetivo(objetivo): quien ya administra por alcance
--     (puede_administrar_rondas_objetivo) o un supervisor autorizado (puesto
--     supervisor / jefe_supervisores / direccion_operativa, o rol supervisor
--     sin puesto), activo y con acceso habilitado.
--  2) Se usa SÓLO en: listados e historial (listar_ejecuciones_objetivo,
--     listar_ejecuciones_en_curso_objetivo, listar_rondas_pausadas,
--     rondas_ejecucion_detalle_supervisor, listar_ronda_alertas_objetivo,
--     listar_rondas_programadas_objetivo), resolver_ronda_alerta y las
--     políticas SELECT de ronda_alertas, ronda_alerta_intervenciones,
--     ronda_ejecuciones, ronda_ejecucion_puntos, ronda_pausas, rondas_base,
--     ronda_puntos y ronda_horarios_sin_exigencia.
--     NO se amplía puede_administrar_rondas_objetivo: sigue gobernando la
--     configuración (crear/editar rondas y puntos, QR, ubicación, pausas,
--     cierres administrativos, regularización en lote).
--  3) Cada intervención guarda los responsables de la zona del objetivo y si
--     quien intervino estaba fuera de su zona. Fuera de zona exige resultado y
--     motivo (el camino nuevo de resolver_ronda_alerta); el bloqueo optimista
--     (p_intervenciones_esperadas) ya existe en 20261115120000.
--
-- Las funciones se reescriben desde su definición viva (pg_get_functiondef)
-- reemplazando sólo la llamada de permiso; si una no tiene la llamada esperada,
-- la migración aborta (la definición cambió y hay que revisarla).
-- ============================================================================

begin;

create or replace function public.puede_operar_rondas_objetivo(p_objetivo_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select public.puede_administrar_rondas_objetivo(p_objetivo_id)
    or (public.acceso_habilitado_actual()
        and exists (select 1 from public.objetivos o where o.id = p_objetivo_id)
        and exists (
          select 1 from public.usuarios u
           where u.auth_user_id = auth.uid() and u.estado = 'activo'
             and ( u.puesto_organizacional in ('supervisor', 'jefe_supervisores', 'direccion_operativa')
                   or (u.puesto_organizacional is null and lower(u.rol) = 'supervisor') )))
$$;
revoke all on function public.puede_operar_rondas_objetivo(uuid) from public, anon;
grant execute on function public.puede_operar_rondas_objetivo(uuid) to authenticated, service_role;

-- ── 2a. Listados, historial y resolver: sólo cambia la llamada de permiso ──
do $do$
declare
  v_nombres constant text[] := array[
    'listar_ejecuciones_objetivo', 'listar_ejecuciones_en_curso_objetivo', 'listar_rondas_pausadas',
    'rondas_ejecucion_detalle_supervisor', 'listar_ronda_alertas_objetivo',
    'listar_rondas_programadas_objetivo', 'resolver_ronda_alerta'];
  v_nombre text;
  v_oid oid;
  v_def text;
  v_n integer;
begin
  foreach v_nombre in array v_nombres loop
    v_n := 0;
    for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = v_nombre loop
      v_def := pg_get_functiondef(v_oid);
      if position('puede_administrar_rondas_objetivo(' in v_def) = 0 then
        raise exception 'rondas_operacion_compartida: %(%) no usa puede_administrar_rondas_objetivo; revisar antes de aplicar',
          v_nombre, pg_get_function_identity_arguments(v_oid);
      end if;
      execute replace(v_def, 'puede_administrar_rondas_objetivo(', 'puede_operar_rondas_objetivo(');
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      raise exception 'rondas_operacion_compartida: falta la función %', v_nombre;
    end if;
  end loop;
end $do$;

-- ── 2b. Políticas SELECT ───────────────────────────────────────────────────
-- Las de lectura se reemplazan por equivalentes con puede_operar; las de
-- escritura (INSERT/UPDATE de rondas_base y ronda_puntos) no se tocan.
drop policy if exists "Admin supervisor lee ronda_alertas de su alcance" on public.ronda_alertas;
drop policy if exists rondas_operar_lee_alertas on public.ronda_alertas;
create policy rondas_operar_lee_alertas on public.ronda_alertas
  for select to authenticated using (public.puede_operar_rondas_objetivo(objetivo_id));

drop policy if exists "Admin supervisor lee ronda_alerta_intervenciones de su alcance" on public.ronda_alerta_intervenciones;
drop policy if exists rondas_operar_lee_intervenciones on public.ronda_alerta_intervenciones;
create policy rondas_operar_lee_intervenciones on public.ronda_alerta_intervenciones
  for select to authenticated using (exists (
    select 1 from public.ronda_alertas a
     where a.id = ronda_alerta_intervenciones.ronda_alerta_id and public.puede_operar_rondas_objetivo(a.objetivo_id)));

drop policy if exists "Admin supervisor lee ejecuciones de su alcance" on public.ronda_ejecuciones;
drop policy if exists rondas_operar_lee_ejecuciones on public.ronda_ejecuciones;
create policy rondas_operar_lee_ejecuciones on public.ronda_ejecuciones
  for select to authenticated using (public.puede_operar_rondas_objetivo(objetivo_id));

drop policy if exists "Admin supervisor lee puntos de ejecucion de su alcance" on public.ronda_ejecucion_puntos;
drop policy if exists rondas_operar_lee_ejecucion_puntos on public.ronda_ejecucion_puntos;
create policy rondas_operar_lee_ejecucion_puntos on public.ronda_ejecucion_puntos
  for select to authenticated using (exists (
    select 1 from public.ronda_ejecuciones e
     where e.id = ronda_ejecucion_puntos.ronda_ejecucion_id and public.puede_operar_rondas_objetivo(e.objetivo_id)));

drop policy if exists "Lectura pausas para supervisores autorizados" on public.ronda_pausas;
drop policy if exists rondas_operar_lee_pausas on public.ronda_pausas;
create policy rondas_operar_lee_pausas on public.ronda_pausas
  for select to authenticated using (public.puede_operar_rondas_objetivo(objetivo_id));

drop policy if exists "Admin supervisor lee rondas de su alcance" on public.rondas_base;
drop policy if exists rondas_operar_lee_rondas on public.rondas_base;
create policy rondas_operar_lee_rondas on public.rondas_base
  for select to authenticated using (public.puede_operar_rondas_objetivo(objetivo_id));

drop policy if exists "Admin supervisor lee puntos de su alcance" on public.ronda_puntos;
drop policy if exists rondas_operar_lee_puntos on public.ronda_puntos;
create policy rondas_operar_lee_puntos on public.ronda_puntos
  for select to authenticated using (exists (
    select 1 from public.rondas_base rb
     where rb.id = ronda_puntos.ronda_base_id and public.puede_operar_rondas_objetivo(rb.objetivo_id)));

drop policy if exists "Rondas: horarios sin exigencia para quien administra la ronda" on public.ronda_horarios_sin_exigencia;
drop policy if exists rondas_operar_lee_horarios_sin_exigencia on public.ronda_horarios_sin_exigencia;
create policy rondas_operar_lee_horarios_sin_exigencia on public.ronda_horarios_sin_exigencia
  for select to authenticated using (exists (
    select 1 from public.rondas_base rb
     where rb.id = ronda_horarios_sin_exigencia.ronda_base_id and public.puede_operar_rondas_objetivo(rb.objetivo_id)));

-- ── 3. Responsable de zona e intervención fuera de zona ─────────────────────
alter table public.ronda_alerta_intervenciones
  add column if not exists responsables_zona uuid[],
  add column if not exists fuera_de_zona boolean;

create or replace function public.ronda_intervencion_registrar_zona()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_objetivo uuid;
begin
  if new.supervisor_id is null then
    return new;  -- intervención del sistema
  end if;
  select a.objetivo_id into v_objetivo from public.ronda_alertas a where a.id = new.ronda_alerta_id;
  new.responsables_zona := coalesce((
    select array_agg(distinct sz.supervisor_id order by sz.supervisor_id)
      from public.objetivos o
      join public.supervisor_zonas sz on sz.zona_id = o.zona_id
     where o.id = v_objetivo), '{}');
  new.fuera_de_zona := not public.alcanza_objetivo(new.supervisor_id, v_objetivo);
  if new.fuera_de_zona and new.resultado is null then
    raise exception 'FUERA_DE_ZONA_REQUIERE_RESULTADO: fuera de tu zona la intervención se registra con resultado y motivo';
  end if;
  return new;
end $$;

drop trigger if exists ronda_intervencion_registrar_zona on public.ronda_alerta_intervenciones;
create trigger ronda_intervencion_registrar_zona
  before insert on public.ronda_alerta_intervenciones
  for each row execute function public.ronda_intervencion_registrar_zona();

commit;

-- ── Verificación (solo lectura, después de aplicar) ───────────────────────
-- select proname from pg_proc where prosrc ilike '%puede_operar_rondas_objetivo(%' order by 1;
--   → los 7 listados/resolver + puede_operar_rondas_objetivo
-- select tablename, policyname from pg_policies where policyname like 'rondas_operar_%' order by 1;  → 8
-- select proname from pg_proc where proname in ('agregar_ronda_punto','pausar_ronda','cerrar_ronda_bloqueada')
--    and prosrc ilike '%puede_administrar_rondas_objetivo(%';  → 3 (la configuración no cambió)
