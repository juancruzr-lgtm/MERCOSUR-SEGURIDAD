-- ============================================================================
-- ALCANCE OPERATIVO CANÓNICO — ROLES 2a (Rondas + IA)
-- ============================================================================
-- POR QUÉ
--   Hasta hoy cada consumidor decidía "qué objetivos alcanza un usuario" con su
--   propia copia de `rol='admin' ⇒ todo / rol='supervisor' ⇒ sus zonas`. Con el
--   backfill de ROLES 1, la identidad (`rol`) dejó de ser el eje: el alcance lo
--   define el PUESTO. Sin unificar, Sergio (rol=admin, puesto=supervisor) seguía
--   viendo TODO por ser "admin", contradiciendo su puesto.
--
-- QUÉ INTRODUCE (espejo EXACTO de lib/capacidades.alcanceDe)
--   · alcance_operativo_de(usuario) → 'propio' | 'zonas_asignadas' | 'todas'
--     por puesto, con FALLBACK por rol viejo cuando puesto es null (transición).
--   · alcanza_objetivo(usuario, objetivo) → predicado canónico de alcance.
--
-- QUÉ RECONCILIA (Rondas + IA, puntos de choque únicos)
--   · puede_administrar_rondas_objetivo(objetivo): delega en alcanza_objetivo
--     (lo referencian ~73 objetos SQL de rondas → todos quedan alineados).
--   · estado_acceso_rondas_objetivo(objetivo): mismos `motivo`, pero decididos
--     por alcance canónico en vez de por `rol`.
--
-- CAMBIO DE COMPORTAMIENTO (verificado contra datos reales, 08/09):
--   · Sergio (puesto=supervisor): pasa de "todo" a su zona (35 de 51 objetivos).
--   · Aldo (puesto=jefe_supervisores): pasa a "todas" (antes 0 zonas ⇒ nada).
--   · Todos los demás: sin cambio (admins→gerencia/dir_op/administracion=todas;
--     guardias→vigilador=propio; supervisores por rol siguen en sus zonas).
--
-- SEGURIDAD
--   · Las primitivas NO se otorgan a authenticated: sólo las usan funciones
--     SECURITY DEFINER (que corren como owner). Evita que un cliente sondee el
--     alcance de otro usuario llamándolas con un id ajeno.
--
-- ROLLBACK: supabase/rollback/20260908120000_alcance_operativo_canonico_rollback.sql
-- VERIFICACIÓN: supabase/verificacion/20260908120000_alcance_operativo_canonico_pre_post.sql
-- NOTA: las RPC de escritura de turnos/programación (inlinean el gate) y sus RLS
--   se reconcilian en ROLES 2b, para no dejar superficies "ver pero no poder".
-- ============================================================================

-- ── Primitiva 1: alcance por usuario (puesto con fallback por rol) ───────────
create or replace function public.alcance_operativo_de(p_usuario_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia') then 'todas'
    when u.puesto_organizacional = 'supervisor' then 'zonas_asignadas'
    when u.puesto_organizacional = 'vigilador' then 'propio'
    -- Fallback por rol viejo mientras puesto sea null (idéntico a lib/capacidades).
    when lower(u.rol) = 'admin' then 'todas'
    when lower(u.rol) = 'supervisor' then 'zonas_asignadas'
    else 'propio'
  end
  from public.usuarios u
  where u.id = p_usuario_id
$$;

-- ── Primitiva 2: ¿el usuario alcanza el objetivo? ────────────────────────────
create or replace function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case public.alcance_operativo_de(p_usuario_id)
    when 'todas' then true
    when 'zonas_asignadas' then exists (
      select 1
      from public.objetivos o
      join public.supervisor_zonas sz on sz.zona_id = o.zona_id
      where o.id = p_objetivo_id
        and sz.supervisor_id = p_usuario_id
    )
    else false  -- 'propio' u desconocido: no administra objetivos por zona
  end
$$;

revoke all on function public.alcance_operativo_de(uuid) from public;
revoke all on function public.alcance_operativo_de(uuid) from anon;
revoke all on function public.alcanza_objetivo(uuid, uuid) from public;
revoke all on function public.alcanza_objetivo(uuid, uuid) from anon;

-- ── Rondas: puede_administrar_rondas_objetivo delega en la primitiva ─────────
create or replace function public.puede_administrar_rondas_objetivo(p_objetivo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.auth_user_id = auth.uid()
      and u.estado = 'activo'
      and public.alcanza_objetivo(u.id, p_objetivo_id)
  )
$$;

revoke all on function public.puede_administrar_rondas_objetivo(uuid) from public;
revoke all on function public.puede_administrar_rondas_objetivo(uuid) from anon;
grant execute on function public.puede_administrar_rondas_objetivo(uuid) to authenticated;

-- ── Rondas: estado_acceso_rondas_objetivo por alcance canónico ───────────────
-- Conserva EXACTAMENTE los mismos `motivo` y el conteo de rondas; sólo cambia el
-- eje de decisión de `rol` a alcance (así Sergio cae en supervisor_en_zona /
-- fuera_de_zona según su zona, y Aldo en administrador).
create or replace function public.estado_acceso_rondas_objetivo(p_objetivo_id uuid)
returns table(puede_administrar boolean, motivo text, cantidad_rondas bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_alcance text;
  v_zona_id uuid;
  v_usuario_id uuid;
begin
  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = auth.uid()
    and u.estado = 'activo'
  limit 1;

  select o.zona_id into v_zona_id
  from public.objetivos o
  where o.id = p_objetivo_id;

  cantidad_rondas := null;

  if v_usuario_id is null then
    puede_administrar := false;
    motivo := 'sin_permiso';
  else
    v_alcance := public.alcance_operativo_de(v_usuario_id);
    if v_alcance = 'todas' then
      puede_administrar := true;
      motivo := 'administrador';
    elsif v_alcance <> 'zonas_asignadas' then
      puede_administrar := false;
      motivo := 'sin_permiso';
    elsif v_zona_id is null then
      puede_administrar := false;
      motivo := 'objetivo_sin_zona';
    elsif public.alcanza_objetivo(v_usuario_id, p_objetivo_id) then
      puede_administrar := true;
      motivo := 'supervisor_en_zona';
    else
      puede_administrar := false;
      motivo := 'fuera_de_zona';
    end if;
  end if;

  if puede_administrar then
    select count(*) into cantidad_rondas
    from public.rondas_base rb
    where rb.objetivo_id = p_objetivo_id;
  end if;

  return next;
end;
$function$;

revoke all on function public.estado_acceso_rondas_objetivo(uuid) from public;
revoke all on function public.estado_acceso_rondas_objetivo(uuid) from anon;
grant execute on function public.estado_acceso_rondas_objetivo(uuid) to authenticated;
