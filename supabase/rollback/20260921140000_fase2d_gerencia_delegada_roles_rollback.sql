-- ROLLBACK de 20260921140000_fase2d_gerencia_delegada_roles.sql
-- Restaura el trigger original (rol/puesto/económico por
-- puede_gestionar_usuarios_roles_actual) y elimina helpers + tabla de delegación.
-- OJO: reabre el estado previo (Administración NO cambia rol/puesto; cuenta_bancaria
-- vuelve a admin_pleno; sin delegación gerencial).

begin;

create or replace function public.usuarios_proteger_campos_criticos()
returns trigger language plpgsql security definer set search_path to 'public','pg_catalog' as $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if ( new.rol is not null and lower(new.rol) in ('admin','supervisor') ) or new.puesto_organizacional is not null or new.cuenta_bancaria is not null then
      if not public.puede_gestionar_usuarios_roles_actual() then raise exception 'Sólo Gerencia puede asignar rol/puesto privilegiado o datos económicos en el alta'; end if;
    end if;
    if coalesce(new.acceso_admin_pleno, false) = true then
      if not public.es_gerencia_actual() then raise exception 'Sólo Gerencia puede otorgar acceso_admin_pleno'; end if;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.rol is distinct from old.rol or new.puesto_organizacional is distinct from old.puesto_organizacional then
      if not public.puede_gestionar_usuarios_roles_actual() then raise exception 'Sólo Gerencia puede cambiar rol o puesto_organizacional'; end if;
    end if;
    if new.cuenta_bancaria is distinct from old.cuenta_bancaria then
      if not public.puede_gestionar_usuarios_roles_actual() then raise exception 'Sólo Gerencia puede modificar la cuenta bancaria'; end if;
    end if;
    if new.acceso_admin_pleno is distinct from old.acceso_admin_pleno then
      if not public.es_gerencia_actual() then raise exception 'Sólo Gerencia puede cambiar acceso_admin_pleno'; end if;
    end if;
    if new.auth_user_id is distinct from old.auth_user_id then
      if not ( public.puede_gestionar_usuarios_roles_actual() or new.auth_user_id = auth.uid() ) then raise exception 'No autorizado a cambiar auth_user_id'; end if;
    end if;
    return new;
  end if;
  return new;
end;
$function$;

drop policy if exists gerencia_delegaciones_select on public.gerencia_delegaciones;
drop policy if exists gerencia_delegaciones_insert on public.gerencia_delegaciones;
drop policy if exists gerencia_delegaciones_update on public.gerencia_delegaciones;
drop policy if exists gerencia_delegaciones_delete on public.gerencia_delegaciones;
drop table if exists public.gerencia_delegaciones;

drop function if exists public.puede_gestionar_roles_normales_actual();
drop function if exists public.puede_acceder_gerencia_actual();
drop function if exists public.tiene_delegacion_gerencia_actual();
drop function if exists public.tiene_delegacion_gerencia(uuid);

commit;

notify pgrst, 'reload schema';
