-- ============================================================================
-- RLS USUARIOS por CAPACIDAD/PUESTO — ROLES 5 (cierre del hueco crítico)
-- ============================================================================
-- PROBLEMA (vivo): la policy "Admin acceso total usuarios" FOR ALL USING(true)
-- para `public` abre la tabla entera a CUALQUIER autenticado: por sesión directa
-- (PostgREST, sin pasar por la API) un vigilador podía UPDATE usuarios y escalar
-- su rol/puesto, o leer cuenta_bancaria/cuil/dni de todos.
--
-- SOLUCIÓN: dropear la policy abierta y gobernar por policies de CAPACIDAD que
-- hablan el MISMO idioma que las APIs (puesto, no rol) — así Sergio (rol=admin,
-- puesto=supervisor) NO recupera privilegios globales. Un trigger impide escalar
-- rol / puesto_organizacional / cuenta_bancaria por escritura directa.
--
-- SERVICE_ROLE: la API (service_role, auth.uid() NULL) YA valida capacidad
-- (ROLES 4) y es la vía legítima de escritura; el trigger la deja pasar. El
-- enforcement de RLS/trigger es para el camino directo cliente→PostgREST.
--
-- NO toca usuarios.rol de ninguna fila (sólo policies/trigger). is_admin() /
-- is_supervisor_or_admin() quedaban SÓLO en estas policies de usuarios; al
-- reemplazarlas, dejan de gobernar (se conserva su definición por compatibilidad).
--
-- ROLLBACK: supabase/rollback/20260908140000_rls_usuarios_capacidades_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/authz_matriz_rls_usuarios.sql (simula persona + ROLLBACK)
-- ============================================================================

-- ── Helpers puesto-aware para la sesión actual (auth.uid) ────────────────────
create or replace function public.es_operador_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')) )
  )
$$;

create or replace function public.puede_gestionar_personal_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  )
$$;

create or replace function public.puede_gestionar_usuarios_roles_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  )
$$;

revoke all on function public.es_operador_actual() from public, anon;
revoke all on function public.puede_gestionar_personal_actual() from public, anon;
revoke all on function public.puede_gestionar_usuarios_roles_actual() from public, anon;
grant execute on function public.es_operador_actual() to authenticated;
grant execute on function public.puede_gestionar_personal_actual() to authenticated;
grant execute on function public.puede_gestionar_usuarios_roles_actual() to authenticated;

-- ── Cerrar la policy abierta y reemplazar las granulares por capacidad ───────
drop policy if exists "Admin acceso total usuarios" on public.usuarios;
drop policy if exists usuarios_select on public.usuarios;
drop policy if exists usuarios_insert on public.usuarios;
drop policy if exists usuarios_update on public.usuarios;
drop policy if exists usuarios_delete on public.usuarios;
drop policy if exists usuarios_vincular_auth on public.usuarios;

-- Lectura: operadores (supervisor/jefe/dir_op/administracion/gerencia) ven el
-- padrón (nombres para operar); el resto (vigilador) sólo su propia fila.
create policy usuarios_select on public.usuarios for select to authenticated
  using ( public.es_operador_actual() or auth_user_id = auth.uid() );

-- Alta de personal: Administración + Gerencia. (El trigger acota rol/puesto/CBU.)
create policy usuarios_insert on public.usuarios for insert to authenticated
  with check ( public.puede_gestionar_personal_actual() );

-- Edición de personal: Administración + Gerencia. (El trigger acota rol/puesto/CBU.)
create policy usuarios_update on public.usuarios for update to authenticated
  using ( public.puede_gestionar_personal_actual() )
  with check ( public.puede_gestionar_personal_actual() );

-- Baja física: sólo Gerencia (sensible).
create policy usuarios_delete on public.usuarios for delete to authenticated
  using ( public.puede_gestionar_usuarios_roles_actual() );

-- Auto-vinculación en el primer login: el usuario puede enlazar SU fila (aún sin
-- auth_user_id, match por email de la sesión) con su auth.uid. El trigger sigue
-- impidiendo que por esta vía se escale rol/puesto/CBU. Sin esto, el login por
-- fallback de email no persistiría la vinculación.
create policy usuarios_vincular_auth on public.usuarios for update to authenticated
  using ( auth_user_id is null and lower(coalesce(email,'')) = lower(coalesce(auth.jwt() ->> 'email','')) )
  with check ( auth_user_id = auth.uid() );

-- ── Trigger: impedir escalar rol/puesto/CBU por escritura directa ────────────
create or replace function public.usuarios_proteger_campos_criticos()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  -- service_role (API, ya gateada por capacidad en ROLES 4): auth.uid() es NULL.
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if ( new.rol is not null and lower(new.rol) in ('admin','supervisor') )
       or new.puesto_organizacional is not null
       or new.cuenta_bancaria is not null then
      if not public.puede_gestionar_usuarios_roles_actual() then
        raise exception 'Sólo Gerencia puede asignar rol/puesto privilegiado o datos económicos en el alta';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.rol is distinct from old.rol
       or new.puesto_organizacional is distinct from old.puesto_organizacional then
      if not public.puede_gestionar_usuarios_roles_actual() then
        raise exception 'Sólo Gerencia puede cambiar rol o puesto_organizacional';
      end if;
    end if;
    if new.cuenta_bancaria is distinct from old.cuenta_bancaria then
      if not public.puede_gestionar_usuarios_roles_actual() then
        raise exception 'Sólo Gerencia puede modificar la cuenta bancaria';
      end if;
    end if;
    if new.auth_user_id is distinct from old.auth_user_id then
      if not ( public.puede_gestionar_usuarios_roles_actual() or new.auth_user_id = auth.uid() ) then
        raise exception 'No autorizado a cambiar auth_user_id';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$fn$;

drop trigger if exists usuarios_proteger_campos_criticos on public.usuarios;
create trigger usuarios_proteger_campos_criticos
  before insert or update on public.usuarios
  for each row execute function public.usuarios_proteger_campos_criticos();
