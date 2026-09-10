-- ============================================================================
-- Permisos operativos de supervisor/jefe: crear objetivos (B1), puestos de
-- trabajo por alcance (D1), alta/baja de vigiladores por RPC (D2)
-- ============================================================================
--
-- Regla (JC): supervisor administra integralmente la operación de SUS zonas;
-- jefe_supervisores, la de TODAS. Sin rol='admin' como fuente de verdad, sin
-- USING(true), sin ampliar económico/config/roles. El alcance se decide por
-- puesto + supervisor_zonas (funciones canónicas ya aplicadas).
--
-- B1  crear_objetivo_operativo(...)  — el objetivo NACE con zona válida en
--     alcance. INSERT directo de objetivos sigue cerrado (objetivos_insert_admin
--     = alcance 'todas'); los supervisores crean por esta RPC.
-- D1  puestos INSERT/UPDATE/DELETE pasan de rol='admin' a alcance del objetivo
--     (alcanza_objetivo_actual): supervisor en su zona, jefe todas, vigilador no.
-- D2  resolver_solicitud_personal_operativo(...) — alta/baja de VIGILADORES por
--     solicitud, sin abrir INSERT/UPDATE general sobre usuarios. La RPC fija
--     rol guardia/vigilador, whitelist de campos, y valida alcance en la baja.
--
-- ROLLBACK: supabase/rollback/20260910200000_permisos_operativos_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260910200000_permisos_operativos_pre_post.sql
-- Idempotente: sí.
-- ============================================================================

begin;

-- ── Helpers de alcance ──────────────────────────────────────────────────────

-- ¿La zona está en el alcance del usuario actual? ('todas', o asignada). Para
-- CREAR objetivo, donde todavía no hay objetivo sobre el cual medir alcance.
create or replace function public.alcanza_zona_actual(p_zona_id uuid)
returns boolean
language sql stable security definer set search_path to 'public','pg_catalog'
as $$
  select p_zona_id is not null and exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and (
        public.alcance_operativo_de(u.id) = 'todas'
        or exists (select 1 from public.supervisor_zonas sz
                   where sz.supervisor_id = u.id and sz.zona_id = p_zona_id)
      )
  )
$$;

-- ¿El actor puede dar de BAJA a este vigilador según su alcance OPERATIVO VIGENTE?
-- Jefe/'todas' => sí, siempre.
-- Supervisor => sólo si la operación VIGENTE del vigilador pertenece a sus zonas.
-- La historia vieja NO veta (un turno de hace meses en otra zona no bloquea).
-- "Operación vigente" (mismo criterio que usa la app: la actividad, no una
-- tabla de asignación —`asignaciones` está en desuso):
--   1) zonas de turnos de HOY en adelante (fecha >= current_date); si no hay,
--   2) la zona del ÚLTIMO turno (última operación activa).
-- El supervisor puede si TODAS esas zonas vigentes están en su alcance (así no
-- inactiva a alguien que HOY también trabaja en una zona que no controla). Sin
-- turnos, o última zona nula => sólo 'todas' (fail-closed para el supervisor).
create or replace function public.alcanza_baja_vigilador_actual(p_target uuid)
returns boolean
language sql stable security definer set search_path to 'public','pg_catalog'
as $$
  with actor as (
    select id from public.usuarios where auth_user_id = auth.uid() and estado='activo' limit 1
  ),
  vigentes as (
    select distinct o.zona_id
    from public.turnos t join public.objetivos o on o.id = t.objetivo_id
    where t.guardia_id = p_target and t.fecha >= current_date
  ),
  ultima as (
    select o.zona_id
    from public.turnos t join public.objetivos o on o.id = t.objetivo_id
    where t.guardia_id = p_target
    order by t.fecha desc limit 1
  ),
  ambito as (
    select zona_id from vigentes
    union
    select zona_id from ultima where not exists (select 1 from vigentes)
  )
  select case
    when not exists (select 1 from actor) then false
    when (select public.alcance_operativo_de(id) from actor) = 'todas' then true
    when not exists (select 1 from ambito) then false                    -- sin operación determinable
    when exists (select 1 from ambito where zona_id is null) then false  -- objetivo sin zona: fail-closed
    else not exists (
      select 1 from ambito a
      where not exists (
        select 1 from public.supervisor_zonas sz
        where sz.zona_id = a.zona_id and sz.supervisor_id = (select id from actor)
      )
    )
  end
$$;

-- Capacidad estrecha de PERSONAL OPERATIVO (alta/baja de vigiladores). Sólo
-- supervisor y jefe_supervisores; administración/gerencia usan gestionar_personal.
create or replace function public.puede_gestionar_personal_operativo_actual()
returns boolean
language sql stable security definer set search_path to 'public','pg_catalog'
as $$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional in ('supervisor','jefe_supervisores')
  )
$$;

-- ── B1: crear objetivo operativo (nace con zona en alcance) ─────────────────
create or replace function public.crear_objetivo_operativo(
  p_zona_id uuid,
  p_nombre text,
  p_cliente text default null,
  p_direccion text default null,
  p_estado text default 'activo',
  p_checklist_plantilla_id uuid default null,
  p_frecuencia_supervision_horas integer default 24,
  p_tipo_ubicacion text default 'fijo',
  p_radio_metros integer default 300,
  p_nocturnidad_activa boolean default false,
  p_nocturnidad_desde time without time zone default null,
  p_nocturnidad_hasta time without time zone default null)
returns public.objetivos
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare v_obj public.objetivos;
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;
  if not public.es_operador_actual() then
    raise exception 'No autorizado para crear objetivos';       -- excluye vigilador
  end if;
  if p_zona_id is null then
    raise exception 'El objetivo debe nacer asociado a una zona';
  end if;
  if not exists (select 1 from public.zonas_operativas z where z.id = p_zona_id) then
    raise exception 'La zona no existe';
  end if;
  if not public.alcanza_zona_actual(p_zona_id) then
    raise exception 'La zona esta fuera de tu alcance';
  end if;
  if coalesce(btrim(p_nombre),'') = '' then raise exception 'El nombre es obligatorio'; end if;
  if coalesce(p_estado,'activo') not in ('activo','inactivo') then raise exception 'Estado invalido'; end if;
  if coalesce(p_tipo_ubicacion,'fijo') not in ('fijo','movil') then raise exception 'Tipo de ubicacion invalido'; end if;
  if p_radio_metros is null or p_radio_metros <= 0 then raise exception 'El radio debe ser mayor que cero'; end if;

  insert into public.objetivos (
    nombre, cliente, direccion, estado, checklist_plantilla_id,
    frecuencia_supervision_horas, zona_id, tipo_ubicacion, radio_metros,
    es_prueba, nocturnidad_activa, nocturnidad_desde, nocturnidad_hasta
  ) values (
    btrim(p_nombre),
    coalesce(nullif(btrim(p_cliente),''), btrim(p_nombre)),   -- cliente es NOT NULL
    nullif(btrim(p_direccion),''),
    coalesce(p_estado,'activo'),
    p_checklist_plantilla_id,
    coalesce(p_frecuencia_supervision_horas,24),
    p_zona_id,
    coalesce(p_tipo_ubicacion,'fijo'),
    p_radio_metros,
    false,
    coalesce(p_nocturnidad_activa,false),
    case when coalesce(p_nocturnidad_activa,false) then p_nocturnidad_desde else null end,
    case when coalesce(p_nocturnidad_activa,false) then p_nocturnidad_hasta else null end
  ) returning * into v_obj;

  return v_obj;
end $$;

-- ── D1: puestos de trabajo por ALCANCE del objetivo (no por rol='admin') ────
drop policy if exists "Admin escribe puestos"   on public.puestos;
drop policy if exists "Admin actualiza puestos"  on public.puestos;
drop policy if exists "Admin elimina puestos"    on public.puestos;

drop policy if exists puestos_insert_alcance on public.puestos;
create policy puestos_insert_alcance on public.puestos
  for insert to authenticated
  with check (public.alcanza_objetivo_actual(objetivo_id));

drop policy if exists puestos_update_alcance on public.puestos;
create policy puestos_update_alcance on public.puestos
  for update to authenticated
  using (public.alcanza_objetivo_actual(objetivo_id))
  with check (public.alcanza_objetivo_actual(objetivo_id));

drop policy if exists puestos_delete_alcance on public.puestos;
create policy puestos_delete_alcance on public.puestos
  for delete to authenticated
  using (public.alcanza_objetivo_actual(objetivo_id));

-- Recorte de privilegios que no pasan por RLS (mismo criterio que M6/M10).
revoke truncate, references, trigger on table public.puestos from authenticated;

-- ── D2: alta/baja de vigiladores por solicitud, sin abrir usuarios ─────────
-- SECURITY DEFINER: hace el INSERT/UPDATE de usuarios como owner. La
-- autorización se resuelve acá; usuarios sigue cerrado para supervisores.
create or replace function public.resolver_solicitud_personal_operativo(p_solicitud_id uuid)
returns public.solicitudes_admin
language plpgsql security definer set search_path to 'public','pg_catalog'
as $$
declare s public.solicitudes_admin; d jsonb; v_rol text; v_ent uuid; v_actor uuid;
begin
  if auth.uid() is null then raise exception 'Sesion requerida'; end if;

  select id into v_actor from public.usuarios
   where auth_user_id = auth.uid() and estado='activo' limit 1;
  if v_actor is null then raise exception 'Usuario no activo'; end if;

  -- Capacidad: supervisor/jefe (operativo) O administracion/gerencia (full).
  if not (public.puede_gestionar_personal_operativo_actual()
          or public.puede_gestionar_personal_actual()) then
    raise exception 'No autorizado para gestionar personal operativo';
  end if;

  select * into s from public.solicitudes_admin where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud inexistente'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud no esta pendiente'; end if;
  if s.tipo not in ('crear_vigilador','baja_vigilador') then
    raise exception 'Tipo de solicitud no permitido por esta via';
  end if;
  d := coalesce(s.datos_json, '{}'::jsonb);

  if s.tipo = 'crear_vigilador' then
    v_rol := coalesce(nullif(btrim(d->>'rol'),''), 'guardia');
    if v_rol not in ('guardia','vigilador') then
      raise exception 'Solo se pueden crear vigiladores/guardias';
    end if;
    if coalesce(btrim(d->>'nombre'),'')='' or coalesce(btrim(d->>'apellido'),'')=''
       or coalesce(btrim(d->>'legajo'),'')='' then
      raise exception 'Faltan datos obligatorios (nombre, apellido, legajo)';
    end if;
    -- Cuenta operativa: whitelist estricta. Nunca puesto_organizacional,
    -- auth_user_id, acceso_interfaz_admin ni capabilities.
    insert into public.usuarios (nombre, apellido, dni, telefono, legajo, email, estado, rol, foto_url)
    values (
      btrim(d->>'nombre'), btrim(d->>'apellido'), nullif(btrim(d->>'dni'),''),
      nullif(btrim(d->>'telefono'),''), btrim(d->>'legajo'),
      nullif(lower(btrim(d->>'email')),''), 'activo', v_rol, nullif(btrim(d->>'foto_url'),'')
    ) returning id into v_ent;

  else  -- baja_vigilador
    v_ent := s.entidad_id;
    if v_ent is null then raise exception 'La solicitud no tiene vigilador asociado'; end if;
    if not exists (select 1 from public.usuarios u
                   where u.id = v_ent and u.rol in ('guardia','vigilador')) then
      raise exception 'El destino no es un vigilador';
    end if;
    -- Alcance: full personal (administracion/gerencia) o alcance operativo.
    if not (public.puede_gestionar_personal_actual()
            or public.alcanza_baja_vigilador_actual(v_ent)) then
      raise exception 'El vigilador esta fuera de tu alcance operativo';
    end if;
    update public.usuarios set estado='inactivo'
     where id = v_ent and rol in ('guardia','vigilador');
  end if;

  update public.solicitudes_admin
     set estado='aprobado', aprobado_por=v_actor, fecha_aprobacion=now(), entidad_id=v_ent
   where id = p_solicitud_id
   returning * into s;
  return s;
end $$;

-- ── Grants de ejecución ─────────────────────────────────────────────────────
grant execute on function public.alcanza_zona_actual(uuid)                       to authenticated;
grant execute on function public.alcanza_baja_vigilador_actual(uuid)             to authenticated;
grant execute on function public.puede_gestionar_personal_operativo_actual()     to authenticated;
grant execute on function public.crear_objetivo_operativo(uuid,text,text,text,text,uuid,integer,text,integer,boolean,time,time) to authenticated;
grant execute on function public.resolver_solicitud_personal_operativo(uuid)     to authenticated;

commit;

notify pgrst, 'reload schema';
