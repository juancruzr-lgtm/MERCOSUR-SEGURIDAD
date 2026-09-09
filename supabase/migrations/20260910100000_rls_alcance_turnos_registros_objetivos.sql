-- ============================================================================
-- RLS por ALCANCE OPERATIVO en turnos, registros_asistencia, supervisor_zonas
-- y objetivos — Etapa 2 del bug "supervisor Rosario veía alertas de Rafaela"
-- ============================================================================
--
-- MOTIVO (auditoría del 2026-09-09, PR #202 = Etapa 1, sólo UI)
--   * turnos."Supervisor CRUD turnos" y registros_asistencia."Supervisor lee
--     registros_asistencia" dan acceso GLOBAL por rol: cualquier cuenta con
--     rol='supervisor' puede leer (y en turnos, escribir) filas de cualquier
--     zona por API directa (PostgREST), aunque la UI ya filtre.
--   * objetivos."Admin acceso total objetivos" es FOR ALL TO public USING
--     (true): cualquier autenticado —incluido un vigilador— puede hoy borrar
--     (DELETE está concedido) o insertar objetivos, y actualizar las columnas
--     con GRANT. El nombre "Admin" no limita nada: la expresión es `true`.
--   * supervisor_zonas sólo deja leer las asignaciones PROPIAS: la resolución
--     de responsables (lib/responsables-operativos.ts) no puede ver quién es
--     el responsable de otra zona y muestra "Sin responsable asignado en la
--     zona" aunque exista (caso real: Rafaela → Wilhjelm).
--
-- DISEÑO — una sola fuente de verdad, SIN lógica de alcance nueva:
--   public.alcanza_objetivo_actual(objetivo_id)  (20260908130000, aplicada)
--     → 'todas'  (jefe_supervisores, direccion_operativa, administracion,
--                 gerencia; fallback rol admin con puesto null): todo.
--     → 'zonas_asignadas' (supervisor, incl. Sergio): sólo objetivos de sus
--       zonas via supervisor_zonas. Objetivo SIN zona ⇒ false (FAIL-CLOSED,
--       consistente con la Etapa 1 / PR #202).
--     → 'propio' (vigilador): false. El vigilador conserva ÚNICAMENTE sus
--       políticas propias existentes, que no se tocan.
--   Se agrega sólo un helper de JOIN (alcanza_turno_actual) que delega en la
--   función canónica: registros_asistencia no tiene objetivo_id.
--
-- QUÉ CAMBIA POR ROL (verificado por simulación con usuarios reales, 09/09):
--   * supervisor zona X: turnos/registros sólo de sus zonas (antes: todos).
--   * jefe_supervisores (rol='supervisor', alcance 'todas'): sigue viendo
--     todo — antes dependía de la policy por rol, ahora del alcance canónico.
--   * administracion/direccion/gerencia y admin legado: sin cambios ('todas').
--   * REGLA (JC, 10/09): el acceso global NUNCA se justifica por
--     usuarios.rol='admin'. Un rol legacy admin con puesto 'supervisor' queda
--     zonificado; el alcance general deriva del PUESTO (jefe_supervisores,
--     administracion, direccion_operativa, gerencia) o del fallback legacy
--     SOLO cuando puesto es null (transición). Por eso acá también se
--     reemplaza "Admin CRUD registros_asistencia" (rol='admin') por una
--     policy de alcance total por puesto.
--   * Sergio (hoy rol='admin', puesto='supervisor'): con estos datos queda
--     ZONIFICADO en todo. Para que tenga alcance general como Jefe de
--     Supervisores, su puesto_organizacional debe pasar a
--     'jefe_supervisores' (cambio de DATOS, fuera de esta migración, con
--     efectos de UI por capacidades — decisión aparte de JC).
--   * jefe_supervisores: alcance 'todas' POR PUESTO; una zona propia
--     asignada no lo limita ('todas' corta antes del chequeo de zona).
--   * vigilador: sin cambios (sólo lo propio); pierde el acceso abierto a
--     borrar/insertar objetivos que dejaba la policy `true`.
--
-- RELACIÓN CON M4–M10 (preparadas, NO aplicadas):
--   Ninguna M4–M10 toca turnos ni registros_asistencia. M6 sí reescribe
--   objetivos: esta migración ADELANTA esa corrección usando LOS MISMOS
--   nombres de policy que M6, con expresiones canónicas post-ROLES.
--   ⚠️ ANTES de aplicar M6 hay que QUITARLE su sección de objetivos (o
--   actualizarla a estas expresiones): M6 usa ia_es_admin (rol='admin') para
--   INSERT/DELETE y hoy jefe_supervisores tiene rol='supervisor' — aplicarla
--   tal cual le sacaría el alta/borrado de objetivos. M9 también quedó
--   obsoleta (pisaría las policies de usuarios de ROLES 5): reescribir antes.
--
-- IMPORTANTE — policies permisivas se combinan por OR: por eso acá se
-- DROPEAN explícitamente las policies globales por rol; no alcanza con sumar
-- una policy nueva al lado.
--
-- ANTES DE EJECUTAR: correr y guardar la sección PRE de
--   supabase/verificacion/20260910100000_rls_alcance_pre_post.sql
-- ROLLBACK: supabase/rollback/20260910100000_rls_alcance_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- ── 0. Helper de join: ¿el turno pertenece a un objetivo en mi alcance? ─────
-- SECURITY DEFINER para no depender de la RLS de turnos dentro de la policy
-- de registros_asistencia (evita recursión y dobles chequeos). Delega TODO el
-- criterio en el alcance canónico.
create or replace function public.alcanza_turno_actual(p_turno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
    from public.turnos t
    where t.id = p_turno_id
      and public.alcanza_objetivo_actual(t.objetivo_id)
  )
$$;

-- ── 1. TURNOS ───────────────────────────────────────────────────────────────
-- Se reemplazan las DOS policies globales por rol por UNA canónica.
-- "Guardia lee sus turnos" (SELECT propio del vigilador) se conserva tal cual.
drop policy if exists "Supervisor CRUD turnos" on public.turnos;
drop policy if exists "Admin CRUD turnos" on public.turnos;

drop policy if exists turnos_alcance_operativo on public.turnos;
create policy turnos_alcance_operativo
  on public.turnos
  for all
  to authenticated
  using (public.alcanza_objetivo_actual(objetivo_id))
  with check (public.alcanza_objetivo_actual(objetivo_id));

-- ── 2. REGISTROS_ASISTENCIA ─────────────────────────────────────────────────
-- Lectura: el supervisor pasa de "lee todo" a "lee lo de su alcance"; el
-- jefe de supervisores y los puestos administrativos leen todo (alcance
-- 'todas' por puesto). Escritura: deja de depender de rol='admin' y pasa al
-- alcance total por puesto (administracion/direccion/gerencia/jefe y admin
-- legado sin puesto). El supervisor común NO gana escritura (igual que hoy:
-- sus correcciones van por RPC). Las policies propias del guardia (gestionar
-- e insertar su propia asistencia) se conservan tal cual.
drop policy if exists "Supervisor lee registros_asistencia" on public.registros_asistencia;
drop policy if exists "Admin CRUD registros_asistencia" on public.registros_asistencia;

drop policy if exists registros_asistencia_select_alcance on public.registros_asistencia;
create policy registros_asistencia_select_alcance
  on public.registros_asistencia
  for select
  to authenticated
  using (public.alcanza_turno_actual(turno_id));

drop policy if exists registros_asistencia_alcance_total on public.registros_asistencia;
create policy registros_asistencia_alcance_total
  on public.registros_asistencia
  for all
  to authenticated
  using (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas')
  with check (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas');

-- ── 3. SUPERVISOR_ZONAS ─────────────────────────────────────────────────────
-- Lectura (SÓLO SELECT) de todas las asignaciones para el personal operativo:
-- lo necesita la resolución de responsables ("Responsable de zona: X"). La
-- tabla no tiene datos sensibles (id, supervisor_id, zona_id). Las policies
-- de escritura existentes (sólo admin) no se tocan; el vigilador NO entra
-- (es_operador_actual, de ROLES 5, excluye 'propio').
drop policy if exists supervisor_zonas_lectura_operativa on public.supervisor_zonas;
create policy supervisor_zonas_lectura_operativa
  on public.supervisor_zonas
  for select
  to authenticated
  using (public.es_operador_actual());

-- ── 4. OBJETIVOS (adelanta la sección `objetivos` de M6, expresiones post-ROLES)
-- Barrido de policies laxas por expresión, no sólo por nombre (mismo criterio
-- que M6): cualquier policy de objetivos con USING/CHECK `true` se elimina.
do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'objetivos'
       and (qual = 'true' or (qual is null and with_check = 'true'))
  loop
    execute format('drop policy %I on public.objetivos', p.policyname);
    raise notice 'eliminada la política laxa objetivos.%', p.policyname;
  end loop;
end $$;
drop policy if exists "Admin acceso total objetivos" on public.objetivos;

-- SELECT: cualquier usuario del padrón ACTIVO (la app del vigilador lista
-- todos los objetivos para fichar, con lat/lng/radio — GuardiaMobile).
drop policy if exists objetivos_select_usuario_activo on public.objetivos;
create policy objetivos_select_usuario_activo
  on public.objetivos
  for select
  to authenticated
  using (public.rondas_usuario_actual_id() is not null);

-- INSERT/DELETE: sólo alcance total (jefe_supervisores, direccion_operativa,
-- administracion, gerencia, admin legado). NO ia_es_admin: jefe_supervisores
-- tiene rol='supervisor' y perdería el alta/borrado que hoy usa.
drop policy if exists objetivos_insert_admin on public.objetivos;
create policy objetivos_insert_admin
  on public.objetivos
  for insert
  to authenticated
  with check (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas');

drop policy if exists objetivos_delete_admin on public.objetivos;
create policy objetivos_delete_admin
  on public.objetivos
  for delete
  to authenticated
  using (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas');

-- UPDATE: por alcance canónico (supervisor sólo su zona; vigilador nunca).
-- Las COLUMNAS siguen limitadas por el GRANT por columnas vigente
-- (20260815100000 + hotfix nocturnidad): esta policy limita QUÉ filas.
drop policy if exists objetivos_update_operador on public.objetivos;
create policy objetivos_update_operador
  on public.objetivos
  for update
  to authenticated
  using (public.alcanza_objetivo_actual(id))
  with check (public.alcanza_objetivo_actual(id));

-- El DELETE de objetivos es un borrado físico legítimo del dashboard admin:
-- se conserva el privilegio (ahora gobernado por objetivos_delete_admin).
-- Se recortan los privilegios que no pasan por RLS o no se usan (M6/M10).
revoke truncate, references, trigger on table public.objetivos from authenticated;

commit;

notify pgrst, 'reload schema';
