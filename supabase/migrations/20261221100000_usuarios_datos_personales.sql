-- Datos personales (DNI, teléfono, CUIL) por función con permiso según responsabilidad.
--
-- Criterio de Gerencia (20/11/2026):
--   · Vigilador: sólo sus propios datos.
--   · Supervisor de zona: DNI y teléfono del personal de su alcance operativo; sin CUIL.
--   · Jefe de supervisores / dirección operativa: DNI y teléfono del personal a su cargo
--     (su alcance operativo actual, 'todas'); sin CUIL en pantalla.
--   · Administración y Gerencia (y delegación gerencial): todo, incluido CUIL.
-- El alcance territorial es el que ya existe (alcance_operativo_de / alcanza_objetivo):
-- esta función no amplía el alcance de nadie.
--
-- «Personal de su alcance» para un supervisor de zona = quien tiene un turno, entre 60 días
-- atrás y 60 adelante, en un objetivo de sus zonas (titular o guardia final de un registro).
--
-- Sólo AGREGA una función. No cambia permisos de tabla (eso va en una migración aparte,
-- después de que el cliente deje de leer las columnas directo).
-- Rollback: drop function public.usuarios_datos_personales(uuid[]);

create or replace function public.usuarios_datos_personales(p_ids uuid[] default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_actor   uuid;
  v_alcance text;
  v_cuil    boolean;
begin
  if v_uid is null then
    -- service_role / procesos del servidor: todo.
    return coalesce((select jsonb_object_agg(u.id, jsonb_build_object('dni', u.dni, 'telefono', u.telefono, 'cuil', u.cuil))
                       from public.usuarios u where p_ids is null or u.id = any(p_ids)), '{}'::jsonb);
  end if;

  select u.id into v_actor from public.usuarios u
   where u.auth_user_id = v_uid and u.estado = 'activo' limit 1;
  if v_actor is null then
    return '{}'::jsonb;
  end if;

  v_cuil := coalesce(public.legajo_puede_gestionar(), false);
  v_alcance := case when public.es_operador_actual() then public.alcance_operativo_de(v_actor) else 'propio' end;

  return coalesce((
    with obj as (
      select o.id from public.objetivos o
       where v_alcance = 'zonas_asignadas' and public.alcanza_objetivo(v_actor, o.id)
    ), t_zona as (
      select t.id, t.guardia_id from public.turnos t join obj on obj.id = t.objetivo_id
       where t.fecha between current_date - 60 and current_date + 60
    ), personal_zona as (
      select guardia_id as id from t_zona where guardia_id is not null
      union
      select r.guardia_final_id from public.registros_asistencia r join t_zona on t_zona.id = r.turno_id
       where r.guardia_final_id is not null
    )
    select jsonb_object_agg(u.id,
             case when v_cuil or u.id = v_actor
                  then jsonb_build_object('dni', u.dni, 'telefono', u.telefono, 'cuil', u.cuil)
                  else jsonb_build_object('dni', u.dni, 'telefono', u.telefono) end)
      from public.usuarios u
     where (p_ids is null or u.id = any(p_ids))
       and ( u.id = v_actor or v_cuil or v_alcance = 'todas'
             or u.id in (select id from personal_zona) )), '{}'::jsonb);
end;
$function$;

revoke all on function public.usuarios_datos_personales(uuid[]) from public, anon;
grant execute on function public.usuarios_datos_personales(uuid[]) to authenticated, service_role;
comment on function public.usuarios_datos_personales(uuid[]) is
  'DNI y teléfono según alcance operativo (propio / zona / todas); CUIL sólo propio o Administración/Gerencia/delegación. Reemplaza la lectura directa de usuarios.dni/cuil/telefono.';
