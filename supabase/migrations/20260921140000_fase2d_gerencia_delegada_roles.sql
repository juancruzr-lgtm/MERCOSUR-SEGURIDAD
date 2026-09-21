-- ============================================================================
-- FASE 2D — Gerencia delegada + gestión de roles/puestos por Administración
-- ============================================================================
--
-- JC (21/09):
--  (1) Administración debe poder cambiar rol/puesto NORMALES (no escalar a
--      gerencia/acceso_admin_pleno/delegación).
--  (2) Gerencia puede DELEGAR temporalmente acceso completo a Gerencia (incluye
--      Liquidaciones + económico) a una persona de Administración, auditable y
--      revocable, con vencimiento opcional. La delegación SUMA acceso, NO cambia
--      puesto ni clasificación (`es_gerencia_actual` sigue siendo clasificación
--      real). Se agrega `puede_acceder_gerencia_actual()` = gerencia real OR
--      delegación activa, para gatear acceso funcional (no clasificación).
--
-- Sergio: su override acceso_admin_pleno se recorta del económico en el lado TS
-- (lib/capacidades) — acá, a nivel base, cuenta_bancaria pasa a exigir
-- `puede_acceder_gerencia_actual()` (gerencia real o delegación), sacando a Sergio
-- del económico también en la base. Sergio conserva roles/config/personal.
--
-- ROLLBACK: supabase/rollback/20260921140000_fase2d_gerencia_delegada_roles_rollback.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tabla de delegaciones gerenciales (trazable)
-- ---------------------------------------------------------------------------
create table if not exists public.gerencia_delegaciones (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  activo       boolean not null default true,
  desde        timestamptz not null default now(),
  hasta        timestamptz null,
  otorgado_por uuid not null references public.usuarios(id),
  otorgado_at  timestamptz not null default now(),
  revocado_por uuid null references public.usuarios(id),
  revocado_at  timestamptz null
);
create index if not exists gerencia_delegaciones_usuario_activo_idx
  on public.gerencia_delegaciones (usuario_id) where activo;

alter table public.gerencia_delegaciones enable row level security;

-- ---------------------------------------------------------------------------
-- 2) Helpers de delegación / acceso funcional
-- ---------------------------------------------------------------------------
-- Vigencia por usuario explícito (para el servidor bajo service_role).
create or replace function public.tiene_delegacion_gerencia(p_usuario_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select exists (
    select 1 from public.gerencia_delegaciones d
    where d.usuario_id = p_usuario_id
      and d.activo = true
      and d.revocado_at is null
      and d.desde <= now()
      and (d.hasta is null or d.hasta > now())
  )
$$;
revoke all on function public.tiene_delegacion_gerencia(uuid) from public, anon;
grant execute on function public.tiene_delegacion_gerencia(uuid) to authenticated;

-- Delegación del usuario actual (para RLS / cliente).
create or replace function public.tiene_delegacion_gerencia_actual()
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and public.tiene_delegacion_gerencia(u.id)
  )
$$;
revoke all on function public.tiene_delegacion_gerencia_actual() from public, anon;
grant execute on function public.tiene_delegacion_gerencia_actual() to authenticated;

-- ACCESO funcional a Gerencia = clasificación real OR delegación activa.
-- (Distinto de es_gerencia_actual, que sigue siendo CLASIFICACIÓN.)
create or replace function public.puede_acceder_gerencia_actual()
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select public.es_gerencia_actual() or public.tiene_delegacion_gerencia_actual()
$$;
revoke all on function public.puede_acceder_gerencia_actual() from public, anon;
grant execute on function public.puede_acceder_gerencia_actual() to authenticated;

-- Gestión de roles/puestos NORMALES = Administración + Gerencia + admin_pleno.
create or replace function public.puede_gestionar_roles_normales_actual()
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$$;
revoke all on function public.puede_gestionar_roles_normales_actual() from public, anon;
grant execute on function public.puede_gestionar_roles_normales_actual() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) RLS de gerencia_delegaciones: sólo Gerencia REAL otorga/revoca.
-- ---------------------------------------------------------------------------
-- SELECT: Gerencia real (panel) o el propio beneficiario.
create policy gerencia_delegaciones_select on public.gerencia_delegaciones
  for select to authenticated
  using (
    public.es_gerencia_actual()
    or exists (select 1 from public.usuarios u where u.id = usuario_id and u.auth_user_id = auth.uid())
  );
-- INSERT: sólo Gerencia real, beneficiario Administración, otorgado_por = sí mismo.
create policy gerencia_delegaciones_insert on public.gerencia_delegaciones
  for insert to authenticated
  with check (
    public.es_gerencia_actual()
    and exists (select 1 from public.usuarios u where u.id = usuario_id and u.puesto_organizacional = 'administracion')
    and exists (select 1 from public.usuarios a where a.id = otorgado_por and a.auth_user_id = auth.uid())
  );
-- UPDATE (revocar): sólo Gerencia real.
create policy gerencia_delegaciones_update on public.gerencia_delegaciones
  for update to authenticated
  using (public.es_gerencia_actual())
  with check (public.es_gerencia_actual());
-- DELETE: sólo Gerencia real (limpieza).
create policy gerencia_delegaciones_delete on public.gerencia_delegaciones
  for delete to authenticated
  using (public.es_gerencia_actual());

-- ---------------------------------------------------------------------------
-- 4) Trigger de protección de campos críticos (rol/puesto/económico/pleno)
--    Divide NORMAL vs PRIVILEGIADO. NOTA: bajo service_role auth.uid() es null y
--    el trigger no aplica (los endpoints validan por código). Protege escrituras
--    directas de cliente (anon + JWT de usuario).
-- ---------------------------------------------------------------------------
create or replace function public.usuarios_proteger_campos_criticos()
returns trigger language plpgsql security definer set search_path to 'public','pg_catalog' as $function$
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    -- Alta con nivel PRIVILEGIADO (gerencia, o admin sin puesto) => sólo Gerencia real.
    if (new.puesto_organizacional = 'gerencia')
       or (new.puesto_organizacional is null and new.rol is not null and lower(new.rol) = 'admin') then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede crear usuarios con nivel gerencia o admin sin puesto';
      end if;
    -- Alta con rol/puesto asignado (normal) => gestión de roles normales.
    elsif (new.rol is not null and lower(new.rol) in ('admin','supervisor'))
          or new.puesto_organizacional is not null then
      if not public.puede_gestionar_roles_normales_actual() then
        raise exception 'No autorizado a asignar rol/puesto en el alta';
      end if;
    end if;
    if new.cuenta_bancaria is not null then
      if not public.puede_acceder_gerencia_actual() then
        raise exception 'Sólo Gerencia (o delegación gerencial) puede cargar datos bancarios';
      end if;
    end if;
    if coalesce(new.acceso_admin_pleno, false) = true then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede otorgar acceso_admin_pleno';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.rol is distinct from old.rol or new.puesto_organizacional is distinct from old.puesto_organizacional then
      -- PRIVILEGIADO: tocar gerencia (origen o destino), o dejar admin sin puesto.
      if (new.puesto_organizacional = 'gerencia' or old.puesto_organizacional = 'gerencia')
         or (new.puesto_organizacional is null and new.rol is not null and lower(new.rol) = 'admin') then
        if not public.es_gerencia_actual() then
          raise exception 'Sólo Gerencia puede asignar/quitar el nivel gerencia o admin sin puesto';
        end if;
      else
        if not public.puede_gestionar_roles_normales_actual() then
          raise exception 'No autorizado a cambiar rol o puesto_organizacional';
        end if;
      end if;
    end if;
    if new.cuenta_bancaria is distinct from old.cuenta_bancaria then
      if not public.puede_acceder_gerencia_actual() then
        raise exception 'Sólo Gerencia (o delegación gerencial) puede modificar la cuenta bancaria';
      end if;
    end if;
    if new.acceso_admin_pleno is distinct from old.acceso_admin_pleno then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede cambiar acceso_admin_pleno';
      end if;
    end if;
    if new.auth_user_id is distinct from old.auth_user_id then
      if not ( public.puede_gestionar_roles_normales_actual() or new.auth_user_id = auth.uid() ) then
        raise exception 'No autorizado a cambiar auth_user_id';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$function$;

commit;

notify pgrst, 'reload schema';
