-- ============================================================================
-- Seguridad (auditoría alta de vigiladores 06/11/2026) — FICHAJE SÓLO ACTIVOS
-- ============================================================================
-- PROBLEMA (verificado en producción el 06/11):
--   La política "Guardia gestiona sus registros" (ALL) y "guardias pueden insertar
--   su asistencia" (INSERT) sobre registros_asistencia sólo miran que la fila sea
--   del propio usuario (y el rol). No miran usuarios.estado. La única restrictiva
--   (acceso_bloqueado_baja) mira acceso_bloqueado, no el estado. Resultado: un
--   usuario INACTIVO que conserva su cuenta (hoy 27 inactivos con cuenta, 5 de
--   ellos sin bloqueo) puede insertar/editar fichajes propios desde el cliente.
--   Lo mismo con las evidencias del ingreso (tabla evidencias y bucket
--   ingreso-evidencias).
--   Además, la política ALL deja al vigilador BORRAR sus propios fichajes.
--
-- QUÉ HACE (sólo permisos; NINGÚN dato existente se modifica)
--   1. public.actor_activo_actual(): el usuario de la sesión existe, está activo
--      y no tiene el acceso bloqueado.
--   2. Políticas RESTRICTIVAS (se suman a todas las permisivas) en
--      registros_asistencia para INSERT, UPDATE y DELETE: exigen actor activo.
--      La lectura (SELECT) no cambia: el historial se sigue viendo igual.
--   3. DELETE de registros_asistencia sólo para personal de conducción
--      (es_operador_actual). El vigilador nunca borra fichajes (la app no lo hace).
--   4. evidencias: INSERT/UPDATE exigen actor activo.
--   5. storage ingreso-evidencias: INSERT exige actor activo.
--   6. Se elimina la política muerta "guardias_insertan_asistencia"
--      (guardia_id = auth.uid(): compara el id de empleado con el id de Auth, que
--      nunca coinciden — 0 filas en producción con usuarios.id = auth_user_id).
--   7. Se quita TRUNCATE (no pasa por RLS) a anon/authenticated sobre
--      registros_asistencia y evidencias.
--
-- QUÉ NO CAMBIA
--   * Fichajes históricos, horas liquidables, triggers de liquidación/salidas.
--   * Funciones SECURITY DEFINER (registrar_cobertura, corregir_registro_asistencia,
--     cerrar_turno, anular_registro_manual, ...): corren como su dueño y no pasan
--     por RLS; además sólo las usan Supervisión/Administración, que están activos.
--     Corregir el fichaje VIEJO de alguien que hoy está inactivo sigue funcionando.
--   * Rutas /api con service_role (cierre automático, edición de turnos):
--     no pasan por RLS. /api/upload-evidence agrega el control en el código.
--
-- EFECTO OPERATIVO A CONOCER
--   * Si a un vigilador se lo pasa a inactivo con el turno en curso, ya no puede
--     marcar su salida desde el celular: la cierra el supervisor o el cierre
--     automático, como con cualquier salida faltante.
--
-- Rollback: supabase/rollback/20261208100000_fichaje_solo_activos_rollback.sql
-- ============================================================================

begin;

create or replace function public.actor_activo_actual()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.usuarios u
     where u.auth_user_id = auth.uid()
       and u.estado = 'activo'
       and not coalesce(u.acceso_bloqueado, false)
  )
$$;

revoke all on function public.actor_activo_actual() from public, anon;
grant execute on function public.actor_activo_actual() to authenticated;

comment on function public.actor_activo_actual() is
  'Sesión de un empleado activo y sin acceso bloqueado. Base de las políticas restrictivas de fichaje (20261208100000).';

-- ── registros_asistencia ────────────────────────────────────────────────────
drop policy if exists "fichaje_solo_activos_insert" on public.registros_asistencia;
create policy "fichaje_solo_activos_insert" on public.registros_asistencia
  as restrictive for insert to authenticated
  with check ((select public.actor_activo_actual()));

drop policy if exists "fichaje_solo_activos_update" on public.registros_asistencia;
create policy "fichaje_solo_activos_update" on public.registros_asistencia
  as restrictive for update to authenticated
  using ((select public.actor_activo_actual()))
  with check ((select public.actor_activo_actual()));

drop policy if exists "fichaje_borrar_solo_conduccion" on public.registros_asistencia;
create policy "fichaje_borrar_solo_conduccion" on public.registros_asistencia
  as restrictive for delete to authenticated
  using ((select public.actor_activo_actual()) and (select public.es_operador_actual()));

drop policy if exists "guardias_insertan_asistencia" on public.registros_asistencia;

revoke truncate on public.registros_asistencia from anon, authenticated;

-- ── evidencias del ingreso ──────────────────────────────────────────────────
drop policy if exists "evidencias_solo_activos_insert" on public.evidencias;
create policy "evidencias_solo_activos_insert" on public.evidencias
  as restrictive for insert to authenticated
  with check ((select public.actor_activo_actual()));

drop policy if exists "evidencias_solo_activos_update" on public.evidencias;
create policy "evidencias_solo_activos_update" on public.evidencias
  as restrictive for update to authenticated
  using ((select public.actor_activo_actual()))
  with check ((select public.actor_activo_actual()));

revoke truncate on public.evidencias from anon, authenticated;

-- ── storage: fotos del ingreso ──────────────────────────────────────────────
-- Restrictiva acotada al bucket: no afecta a ningún otro bucket.
drop policy if exists "ingreso_evidencias_solo_activos" on storage.objects;
create policy "ingreso_evidencias_solo_activos" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'ingreso-evidencias' or (select public.actor_activo_actual()));

commit;
