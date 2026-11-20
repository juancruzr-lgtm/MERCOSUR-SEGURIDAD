-- Tablas de auditoría: sólo se agregan filas (F-26 / P-11, ex SEG-11).
--
-- APLICADA en producción el 20/11/2026 (verificada con consultas de catálogo y de datos). Basada en grants, policies y FK VIVOS de producción leídos
-- el 20/11/2026 (sólo lectura), no en el repo.
--
-- Hoy:
--  · `authenticated` tiene UPDATE, DELETE y TRUNCATE sobre registros_asistencia_auditoria,
--    turnos_auditoria, liquidacion_auditoria, servicios_objetivo_auditoria,
--    generacion_turnos_auditoria, puestos_auditoria y jwm_sync_log, y TRUNCATE sobre
--    correccion_turno_manual_log (TRUNCATE no pasa por RLS).
--  · liquidacion_auditoria tiene una policy FOR ALL (puede_liquidar_actual): ADM/GER
--    pueden editar o borrar la auditoría de liquidación.
--  · Borrar la fila padre se lleva la auditoría en cascada:
--      registros_asistencia_auditoria.registro_id → registros_asistencia ON DELETE CASCADE
--      turnos_auditoria.turno_id                  → turnos               ON DELETE CASCADE
--      objetivos_auditoria.objetivo_id            → objetivos            ON DELETE CASCADE
--      ronda_puntos_auditoria.ronda_punto_id      → ronda_puntos         ON DELETE CASCADE
--      liquidacion_auditoria.periodo_id           → liquidacion_periodo  ON DELETE CASCADE
--
-- Qué hace:
--  1. Quita UPDATE, DELETE y TRUNCATE a authenticated/anon en todas las tablas de
--     auditoría/log (INSERT y SELECT quedan como están: hay inserciones desde la app,
--     p. ej. turnos_auditoria en /api/turnos/editar y AppClient).
--  2. liquidacion_auditoria: la policy FOR ALL se parte en SELECT + INSERT (misma regla).
--  3. Las FK de la auditoría hacia su fila padre se QUITAN (se conserva la columna con
--     el id original y su índice). Alternativas evaluadas:
--       · ON DELETE RESTRICT / NO ACTION: rompería borrados legítimos. Cada turno nace
--         con una fila en turnos_auditoria (trigger trg_turnos_auditar_alta), así que
--         ningún turno se podría volver a borrar (generar/regenerar mes, correcciones);
--         eliminar_periodo_liquidacion borra períodos vacíos que pueden tener auditoría.
--       · ON DELETE SET NULL: turnos_auditoria.turno_id es NOT NULL y, aunque se
--         relajara, la fila quedaría sin decir a qué turno/registro/objetivo pertenecía:
--         una auditoría huérfana sin referencia no sirve.
--       · Sin FK (elegida): los borrados siguen funcionando igual que hoy y la
--         auditoría sobrevive con el id original (se puede cruzar con turnos_historial,
--         que ya guarda la foto del turno borrado). Ninguna lectura de la app usa estas
--         FK para embeds de PostgREST (verificado: sólo se embebe usuarios!modificado_por,
--         que no se toca). Se pierde la validación de que el id exista al insertar: las
--         inserciones salen de triggers y RPC que ya leen la fila padre.
--  service_role y las funciones SECURITY DEFINER no cambian.
--
-- Pendiente (fuera de alcance): salidas_anticipadas_historial y
-- evaluaciones_mensuales_historial también caen en cascada con su fila padre; esos
-- padres no se borran desde la app hoy.
--
-- Rollback: supabase/rollback/20261220161000_auditorias_solo_agregar_rollback.sql

-- 1) Sin UPDATE / DELETE / TRUNCATE para la app ----------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'registros_asistencia_auditoria', 'turnos_auditoria', 'liquidacion_auditoria',
    'servicios_objetivo_auditoria', 'generacion_turnos_auditoria', 'puestos_auditoria',
    'jwm_sync_log', 'correccion_turno_manual_log', 'objetivos_auditoria',
    'ronda_puntos_auditoria', 'supervisores_guardia_auditoria']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke update, delete, truncate on table public.%I from authenticated, anon', t);
    end if;
  end loop;
end $$;

-- 2) liquidacion_auditoria: FOR ALL → SELECT + INSERT --------------------------------
drop policy if exists liquidacion_auditoria_liquidacion on public.liquidacion_auditoria;
create policy liquidacion_auditoria_lectura on public.liquidacion_auditoria
  as permissive for select to authenticated
  using (puede_liquidar_actual());
create policy liquidacion_auditoria_alta on public.liquidacion_auditoria
  as permissive for insert to authenticated
  with check (puede_liquidar_actual());

-- 3) La auditoría no cae con su fila padre -------------------------------------------
alter table if exists public.registros_asistencia_auditoria drop constraint if exists registros_asistencia_auditoria_registro_id_fkey;
alter table if exists public.turnos_auditoria               drop constraint if exists turnos_auditoria_turno_id_fkey;
alter table if exists public.objetivos_auditoria            drop constraint if exists objetivos_auditoria_objetivo_id_fkey;
alter table if exists public.ronda_puntos_auditoria         drop constraint if exists ronda_puntos_auditoria_ronda_punto_id_fkey;
alter table if exists public.liquidacion_auditoria          drop constraint if exists liquidacion_auditoria_periodo_id_fkey;
