-- Usuarios: jerarquía de gestión de cuentas en la base.
--
-- APLICADA en producción el 20/11/2026 (verificada con consultas de catálogo y de datos). Basada en las definiciones VIVAS de producción leídas el
-- 20/11/2026 (pg_get_functiondef / pg_policies, sólo lectura), no en el repo.
--
-- Reglas deseadas:
--  (a) Cambiar rol/puesto lo deciden los puestos Administración y Gerencia (y el
--      admin legado sin puesto). Un permiso especial sumado a otro puesto
--      (acceso_admin_pleno) NO habilita cambiar puestos ni roles.
--  (b) Las cuentas no se borran físicamente desde la app: la baja es lógica
--      (estado / baja laboral). Se quita DELETE y TRUNCATE a authenticated/anon.
--  (c) Con identidad de usuario (auth.uid() presente):
--      · nadie cambia su propio rol, puesto ni permisos especiales;
--      · sólo Gerencia toca los datos de acceso de una cuenta de nivel Gerencia
--        (estado, email, DNI, vínculo Auth, accesos);
--      · acceso_interfaz_admin sólo lo cambia Gerencia (igual que acceso_admin_pleno).
--
-- auth.uid() NULL (service_role, cron, procesos internos): se MANTIENE el
-- comportamiento actual (el trigger no actúa). Las rutas del servidor que corren
-- con service_role aplican la misma regla jerárquica en la API
-- (app/api/_lib/destino-usuario.ts). Cambiarlo acá sin distinguir el proceso
-- legítimo cortaría altas, sincronizaciones de acceso y bajas del servidor.
--
-- Rollback: supabase/rollback/20261220150000_usuarios_jerarquia_base_rollback.sql

-- (a) Sin el OR del override acceso_admin_pleno.
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
  )
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
  )
$function$;

-- (b) Baja lógica: sin borrado físico desde la app.
drop policy if exists usuarios_delete on public.usuarios;
revoke delete, truncate on public.usuarios from authenticated, anon;

-- (c) Trigger de campos críticos: mismo cuerpo vivo + reglas nuevas marcadas.
create or replace function public.usuarios_proteger_campos_criticos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_propio boolean;
  v_destino_gerencia boolean;
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
    -- NUEVO: acceso_interfaz_admin sólo lo otorga Gerencia.
    if coalesce(new.acceso_interfaz_admin, false) = true then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede otorgar acceso a la interfaz de Administración';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_propio := old.auth_user_id is not null and old.auth_user_id = auth.uid();
    v_destino_gerencia := old.puesto_organizacional = 'gerencia'
      or (old.puesto_organizacional is null and lower(coalesce(old.rol, '')) = 'admin');

    -- NUEVO: nadie cambia su propio rol, puesto ni permisos especiales.
    if v_propio and (
         new.rol is distinct from old.rol
      or new.puesto_organizacional is distinct from old.puesto_organizacional
      or new.acceso_admin_pleno is distinct from old.acceso_admin_pleno
      or new.acceso_interfaz_admin is distinct from old.acceso_interfaz_admin
      or new.acceso_facturacion is distinct from old.acceso_facturacion
    ) then
      raise exception 'No podés cambiar tu propio puesto, rol o permisos';
    end if;

    -- NUEVO: los datos de acceso de una cuenta de nivel Gerencia sólo los toca Gerencia.
    if v_destino_gerencia and not v_propio and not public.es_gerencia_actual() and (
         new.estado is distinct from old.estado
      or new.email is distinct from old.email
      or new.dni is distinct from old.dni
      or new.auth_user_id is distinct from old.auth_user_id
      or new.acceso_interfaz_admin is distinct from old.acceso_interfaz_admin
      or new.acceso_bloqueado is distinct from old.acceso_bloqueado
    ) then
      raise exception 'Sólo Gerencia puede modificar el acceso de una cuenta de Gerencia';
    end if;

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
    -- NUEVO: acceso_interfaz_admin sólo lo cambia Gerencia.
    if new.acceso_interfaz_admin is distinct from old.acceso_interfaz_admin then
      if not public.es_gerencia_actual() then
        raise exception 'Sólo Gerencia puede cambiar el acceso a la interfaz de Administración';
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
