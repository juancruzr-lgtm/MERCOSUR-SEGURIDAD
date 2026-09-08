-- ROLLBACK de 20260908120000_alcance_operativo_canonico.sql
-- Restaura las dos funciones de rondas a su definición previa (por `rol`) y
-- elimina las primitivas canónicas. No toca datos.
begin;

-- puede_administrar_rondas_objetivo: versión previa (por rol)
create or replace function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and (
        u.rol = 'admin'
        or (
          u.rol = 'supervisor'
          and exists (
            select 1
            from public.objetivos o
            join public.supervisor_zonas sz on sz.zona_id = o.zona_id
            where o.id = p_objetivo_id
              and sz.supervisor_id = u.id
          )
        )
      )
  )
$function$;

-- estado_acceso_rondas_objetivo: versión previa (por rol)
create or replace function public.estado_acceso_rondas_objetivo(p_objetivo_id uuid)
returns table(puede_administrar boolean, motivo text, cantidad_rondas bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_rol text;
  v_zona_id uuid;
  v_usuario_id uuid;
begin
  select u.id, u.rol into v_usuario_id, v_rol
  from public.usuarios u
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1;

  select o.zona_id into v_zona_id
  from public.objetivos o where o.id = p_objetivo_id;

  cantidad_rondas := null;

  if v_usuario_id is null then
    puede_administrar := false; motivo := 'sin_permiso';
  elsif v_rol = 'admin' then
    puede_administrar := true; motivo := 'administrador';
  elsif v_rol <> 'supervisor' then
    puede_administrar := false; motivo := 'sin_permiso';
  elsif v_zona_id is null then
    puede_administrar := false; motivo := 'objetivo_sin_zona';
  elsif exists (
    select 1 from public.supervisor_zonas sz
    where sz.supervisor_id = v_usuario_id and sz.zona_id = v_zona_id
  ) then
    puede_administrar := true; motivo := 'supervisor_en_zona';
  else
    puede_administrar := false; motivo := 'fuera_de_zona';
  end if;

  if puede_administrar then
    select count(*) into cantidad_rondas
    from public.rondas_base rb where rb.objetivo_id = p_objetivo_id;
  end if;

  return next;
end;
$function$;

drop function if exists public.alcanza_objetivo(uuid, uuid);
drop function if exists public.alcance_operativo_de(uuid);

commit;
