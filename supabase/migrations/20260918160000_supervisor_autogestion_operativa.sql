-- ============================================================================
-- Autogestión operativa: supervisores dan de ALTA/BAJA guardias y objetivos
-- SIN aprobación previa, dentro de su ALCANCE.
-- ============================================================================
--
-- Regla (JC 18/09): "supervisores pueden dar de alta/baja guardias y objetivos
-- sin pedir autorización". El ALCANCE lo siguen resolviendo las funciones
-- canónicas ya probadas: jefe_supervisores/'todas' (ej. Sergio) => todas las
-- zonas; supervisor => sólo SUS zonas. No se amplía económico/config/roles.
--
-- Reutiliza:
--   · crear_objetivo_operativo(...)              (ya existe — alta de objetivo)
--   · resolver_solicitud_personal_operativo(...)  (ya existe — alta/baja vigilador)
-- Agrega:
--   · dar_baja_objetivo_operativo(objetivo_id)   (baja de objetivo por alcance)
--   · autoservicio_solicitud_personal_operativo(tipo, entidad_id, datos)
--     crea la solicitud a nombre del actor y la RESUELVE en la misma transacción
--     (auditoría: queda registrado quién dio el alta/baja), reutilizando toda la
--     validación de la RPC existente.
--
-- ROLLBACK: supabase/rollback/20260918160000_supervisor_autogestion_rollback.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- ── Baja de objetivo por alcance (espeja crear_objetivo_operativo) ───────────
create or replace function public.dar_baja_objetivo_operativo(p_objetivo_id uuid)
returns public.objetivos
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare v_obj public.objetivos;
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;
  if not public.es_operador_actual() then
    raise exception 'No autorizado para dar de baja objetivos';   -- excluye vigilador
  end if;
  if p_objetivo_id is null then raise exception 'Falta el objetivo'; end if;
  if not exists (select 1 from public.objetivos o where o.id = p_objetivo_id) then
    raise exception 'El objetivo no existe';
  end if;
  if not public.alcanza_objetivo_actual(p_objetivo_id) then
    raise exception 'El objetivo esta fuera de tu alcance';
  end if;

  update public.objetivos set estado = 'inactivo'
   where id = p_objetivo_id
   returning * into v_obj;
  return v_obj;
end $$;

-- ── Alta/baja de vigilador en un paso, con auditoría ────────────────────────
-- Crea la solicitud (solicitante = actor) y la resuelve en la MISMA transacción
-- llamando a la RPC validada. Si la resolución falla (p.ej. fuera de alcance en
-- la baja), todo hace rollback: no queda solicitud colgada.
create or replace function public.autoservicio_solicitud_personal_operativo(
  p_tipo text, p_entidad_id uuid, p_datos jsonb)
returns public.solicitudes_admin
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare v_actor uuid; v_sol_id uuid; s public.solicitudes_admin;
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;
  if p_tipo not in ('crear_vigilador','baja_vigilador') then
    raise exception 'Tipo no permitido por esta via';
  end if;

  select id into v_actor from public.usuarios
   where auth_user_id = auth.uid() and estado = 'activo' limit 1;
  if v_actor is null then raise exception 'Usuario no activo'; end if;

  -- Misma capacidad que exige la RPC de resolución (fail-fast antes de insertar).
  if not (public.puede_gestionar_personal_operativo_actual()
          or public.puede_gestionar_personal_actual()) then
    raise exception 'No autorizado para gestionar personal operativo';
  end if;

  insert into public.solicitudes_admin (solicitante_id, tipo, entidad, entidad_id, datos_json, estado)
  values (v_actor, p_tipo, 'usuarios', p_entidad_id, coalesce(p_datos, '{}'::jsonb), 'pendiente')
  returning id into v_sol_id;

  -- Reutiliza TODA la validación (whitelist en alta, alcance en la baja) y deja
  -- la solicitud en 'aprobado' con aprobado_por = actor.
  s := public.resolver_solicitud_personal_operativo(v_sol_id);
  return s;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.dar_baja_objetivo_operativo(uuid) from public, anon;
grant execute on function public.dar_baja_objetivo_operativo(uuid) to authenticated;

revoke all on function public.autoservicio_solicitud_personal_operativo(text, uuid, jsonb) from public, anon;
grant execute on function public.autoservicio_solicitud_personal_operativo(text, uuid, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
