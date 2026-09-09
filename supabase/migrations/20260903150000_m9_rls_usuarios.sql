-- ============================================================================
-- M9 — RLS por rol en usuarios (la tabla más expuesta del diagnóstico)
-- ============================================================================
--
-- Continúa el saneamiento M4..M10 anunciado por M1. Se aplica al final de la
-- serie de políticas a propósito: es la tabla con más caminos de acceso.
--
-- MOTIVO
-- En producción conviven la vieja "Admin acceso total usuarios" FOR ALL
-- USING (true) y tres políticas creadas a mano en el panel (usuarios_select /
-- usuarios_update / usuarios_delete, con is_admin()). Como las políticas
-- permisivas se combinan con OR, la laxa gana: cualquier autenticado puede
-- leer TODA la tabla (dni, cuil, email, teléfono de todo el personal) y
-- editar cualquier fila, incluido su propio `rol` — escalamiento directo a
-- admin. Ninguna de las cuatro está versionada; esta migración las reemplaza
-- por un juego versionado.
--
-- USO REAL DESDE EL NAVEGADOR (revisión del 2026-09-03)
--   * Resolución de sesión: SELECT de la fila propia por auth_user_id
--     (AppClient.tsx:617, :5149, :13104; LegajoPage.tsx:266;
--     CentroOperativoObjetivo.tsx:206).
--   * Auto-vinculación en el primer login: SELECT por email de una fila con
--     auth_user_id null y UPDATE que le escribe auth.uid()
--     (AppClient.tsx:623-637). ESTE es el caso de borde crítico: una política
--     de "sólo mi fila por auth_user_id" rompe el login de los no vinculados.
--   * Listas completas: dashboard admin (AppClient.tsx:12980), bandeja
--     (lib/bandeja-datos.ts:97), cierre, gerencia y móvil de supervisor
--     (SupervisorMobile.tsx:622, :627, :705) — pantallas de admin/supervisor.
--     La rama guardia retorna GuardiaMobile antes de esa carga
--     (AppClient.tsx:13137) y no lista usuarios.
--   * Escrituras: alta/edición/estado por admin (AppClient.tsx:1788, :1780,
--     :1805, :9640, :9664); el supervisor edita SOLO email/telefono/estado/
--     foto_url de guardias y vigiladores (SupervisorMobile.tsx:1642-1653,
--     con filtro .in('rol', ['guardia','vigilador'])).
--   * DELETE: ninguno.
--
-- POLÍTICAS NUEVAS
--   usuarios_admin_todo               admin: todo.
--   usuarios_operador_select          admin/supervisor: leen todo el padrón.
--   usuarios_supervisor_update_guardias  supervisor: edita filas de rol
--                                     guardia/vigilador (la fila debe seguir
--                                     siendo guardia/vigilador).
--   usuarios_propio_select            cada uno ve su fila (por auth_user_id,
--                                     o por email si aún no está vinculada).
--   usuarios_vincular_auth            UPDATE sólo de la fila propia sin
--                                     vincular, y sólo si queda vinculada a
--                                     auth.uid().
--
-- TRIGGER usuarios_proteger_campos_criticos (BEFORE UPDATE)
--   La capa RLS no puede comparar OLD con NEW; el trigger cierra los dos
--   escalamientos que quedarían abiertos:
--     * sólo un admin cambia `rol`;
--     * `auth_user_id` sólo cambia por un admin o por la auto-vinculación
--       null → auth.uid().
--   El backend (service_role) y los procesos internos (postgres) quedan
--   exentos: las rutas /api que crean usuarios Auth escriben auth_user_id
--   con service_role y no deben pasar por esta guarda.
--
-- QUÉ NO TOCA: service_role; INSERT queda sólo para admin (el alta de
-- empleados es del dashboard admin); los helpers ia_es_admin/ia_es_operador
-- (SECURITY DEFINER: leen usuarios como dueños de la función, sin recursión
-- de RLS).
--
-- ANTES DE EJECUTAR: correr y GUARDAR la sección PRE de
-- supabase/verificacion/20260903150000_m9_rls_usuarios_pre_post.sql — las
-- políticas del panel no están versionadas y esa salida es su único registro.
--
-- ROLLBACK: supabase/rollback/20260903150000_m9_rls_usuarios_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- 1. Barrido: nombres conocidos + toda política laxa residual.
drop policy if exists "Admin acceso total usuarios" on public.usuarios;
drop policy if exists usuarios_select on public.usuarios;
drop policy if exists usuarios_update on public.usuarios;
drop policy if exists usuarios_delete on public.usuarios;

do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'usuarios'
       and (qual = 'true' or (qual is null and with_check = 'true'))
  loop
    execute format('drop policy %I on public.usuarios', p.policyname);
    raise notice 'M9: eliminada la política laxa usuarios.%', p.policyname;
  end loop;
end $$;

-- 2. Políticas nuevas.
drop policy if exists usuarios_admin_todo on public.usuarios;
create policy usuarios_admin_todo
  on public.usuarios
  for all
  to authenticated
  using (public.ia_es_admin())
  with check (public.ia_es_admin());

drop policy if exists usuarios_operador_select on public.usuarios;
create policy usuarios_operador_select
  on public.usuarios
  for select
  to authenticated
  using (public.ia_es_operador());

drop policy if exists usuarios_supervisor_update_guardias on public.usuarios;
create policy usuarios_supervisor_update_guardias
  on public.usuarios
  for update
  to authenticated
  using (
    public.ia_es_operador()
    and rol in ('guardia', 'vigilador')
  )
  with check (
    public.ia_es_operador()
    and rol in ('guardia', 'vigilador')
  );

drop policy if exists usuarios_propio_select on public.usuarios;
create policy usuarios_propio_select
  on public.usuarios
  for select
  to authenticated
  using (
    auth_user_id = auth.uid()
    or (
      auth_user_id is null
      and email is not null
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists usuarios_vincular_auth on public.usuarios;
create policy usuarios_vincular_auth
  on public.usuarios
  for update
  to authenticated
  using (
    auth_user_id is null
    and email is not null
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (auth_user_id = auth.uid());

-- 3. Trigger de campos críticos. SECURITY INVOKER a propósito: current_user
--    debe ser el rol que ejecuta el DML (authenticated / service_role).
create or replace function public.usuarios_proteger_campos_criticos()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  -- El backend y los procesos internos no pasan por esta guarda.
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if new.rol is distinct from old.rol and not public.ia_es_admin() then
    raise exception 'Solo un administrador puede cambiar el rol de un usuario';
  end if;

  if new.auth_user_id is distinct from old.auth_user_id
     and not public.ia_es_admin()
     and not (old.auth_user_id is null and new.auth_user_id = auth.uid()) then
    raise exception 'Cambio de auth_user_id no permitido';
  end if;

  return new;
end;
$fn$;

drop trigger if exists usuarios_proteger_campos_criticos on public.usuarios;
create trigger usuarios_proteger_campos_criticos
  before update on public.usuarios
  for each row
  execute function public.usuarios_proteger_campos_criticos();

-- 4. Privilegios: ningún borrado de personal desde el navegador (las bajas
--    son estado = 'inactivo'; AGENTS.md: las anulaciones conservan registro).
revoke delete, truncate, references, trigger
  on table public.usuarios from authenticated;

commit;

notify pgrst, 'reload schema';
