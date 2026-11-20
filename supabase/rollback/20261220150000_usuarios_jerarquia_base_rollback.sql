-- Rollback 20261220150000_usuarios_jerarquia_base: vuelve EXACTAMENTE a las
-- definiciones vivas de producción leídas el 20/11/2026 (antes de la migración).
-- Correr como archivo aparte, nunca junto a la migración.

create or replace function public.puede_gestionar_usuarios_roles_actual()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$function$;

create or replace function public.puede_gestionar_roles_normales_actual()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$function$;

grant delete, truncate on public.usuarios to authenticated;
drop policy if exists usuarios_delete on public.usuarios;
create policy usuarios_delete on public.usuarios as permissive for delete to authenticated
  using (puede_gestionar_usuarios_roles_actual());

create or replace function public.usuarios_proteger_campos_criticos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    if (new.puesto_organizacional = 'gerencia')
       or (new.puesto_organizacional is null and new.rol is not null and lower(new.rol) = 'admin') then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede crear usuarios con nivel gerencia o admin sin puesto';
      end if;
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
