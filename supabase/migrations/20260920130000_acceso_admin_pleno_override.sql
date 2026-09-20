-- ============================================================================
-- Override individual de ACCESO ADMIN PLENO (por usuario), sin cambiar el puesto
-- ============================================================================
--
-- Regla (JC 20/09): Sergio Martinez debe conservar `puesto='jefe_supervisores'`
-- (alcance 'todas', zona Rosario, clasificación de supervisor/jefe en reportes y
-- liquidación) PERO recuperar el acceso admin pleno que tenía cuando su rol=admin
-- gobernaba toda la app. Como no existía un override de capacidades por usuario
-- (sólo puesto, rol y acceso_interfaz_admin), se agrega el MÍNIMO necesario:
--
--   · Columna `usuarios.acceso_admin_pleno` (bool). Es un flag GENÉRICO por
--     usuario (no hardcodea a nadie); acá se enciende sólo para Sergio.
--   · Helper `tiene_acceso_admin_pleno_actual()` (lee el flag del usuario actual).
--   · Se SUMA (OR) ese override a los gates de ACCESO que Sergio había perdido:
--     puede_gestionar_personal_actual, puede_gestionar_usuarios_roles_actual,
--     puede_liquidar_actual. NO se toca `es_gerencia_actual` (es CLASIFICACIÓN):
--     así Sergio gana ACCESO económico/liquidación/personal pero NO queda
--     clasificado como gerencia.
--   · Config/Sistema ya lo pasa por la rama `rol='admin'` legacy de esas tablas;
--     la UI la reabre el flag vía lib/capacidades.ts (esAdminPleno).
--
-- El flag NO cambia puesto, rol, alcance ni la asignación de zonas. Es específico
-- del/los usuario(s) marcados. La columna queda PROTEGIDA: sólo Gerencia (pura)
-- puede encenderla/apagarla (trigger), para que un titular del flag no pueda
-- "acuñar" nuevos admins plenos.
--
-- ROLLBACK: supabase/rollback/20260920130000_acceso_admin_pleno_override_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- 1) Columna override (default false = nadie cambia salvo a quien se marque)
alter table public.usuarios
  add column if not exists acceso_admin_pleno boolean not null default false;

-- 2) Helper: ¿el usuario actual tiene el override?
create or replace function public.tiene_acceso_admin_pleno_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.acceso_admin_pleno = true
  )
$$;
revoke all on function public.tiene_acceso_admin_pleno_actual() from public, anon;
grant execute on function public.tiene_acceso_admin_pleno_actual() to authenticated;

-- 3) Sumar el override (OR) a los gates de ACCESO perdidos por Sergio.
--    (Se reproduce el cuerpo existente + OR; NO se toca es_gerencia_actual.)
create or replace function public.puede_gestionar_personal_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional in ('administracion','gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$$;

create or replace function public.puede_gestionar_usuarios_roles_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) or public.tiene_acceso_admin_pleno_actual()
$$;

create or replace function public.puede_liquidar_actual()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $fn$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion')
  or public.tiene_acceso_admin_pleno_actual()
$fn$;

-- 4) Proteger la columna: sólo Gerencia PURA puede cambiarla (no el propio flag,
--    para que un titular no pueda acuñar nuevos admins plenos). Se re-crea el
--    trigger existente agregando esa comprobación.
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
    if coalesce(new.acceso_admin_pleno, false) = true then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede otorgar acceso_admin_pleno';
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
    if new.acceso_admin_pleno is distinct from old.acceso_admin_pleno then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede cambiar acceso_admin_pleno';
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

-- 5) Encender el override SÓLO para Sergio Martinez (dato). No cambia su puesto.
update public.usuarios
   set acceso_admin_pleno = true
 where id = '69493cc2-15d6-4618-893e-4a9b1d044df8'
   and lower(rol) = 'admin';

commit;

notify pgrst, 'reload schema';
