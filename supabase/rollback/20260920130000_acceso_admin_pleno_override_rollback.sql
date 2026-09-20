-- ROLLBACK de 20260920130000_acceso_admin_pleno_override.sql
-- Restaura las funciones/trigger a su cuerpo previo (sin el override) y elimina
-- la columna y el helper. Sergio vuelve a quedar acotado a su puesto.
begin;

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

create or replace function public.puede_liquidar_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion')
$fn$;

create or replace function public.usuarios_proteger_campos_criticos()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
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

update public.usuarios set acceso_admin_pleno = false;
drop function if exists public.tiene_acceso_admin_pleno_actual();
alter table public.usuarios drop column if exists acceso_admin_pleno;

commit;
notify pgrst, 'reload schema';
