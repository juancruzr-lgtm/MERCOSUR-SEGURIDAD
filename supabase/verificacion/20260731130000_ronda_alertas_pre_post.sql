-- ============================================================================
-- VERIFICACIÓN — ALERTAS DE RONDAS (A1 + A2)
-- ============================================================================
-- Acompaña a las migraciones 20260731100000..130000.
-- Aplicar las 4 migraciones antes de ejecutar este verificador.
-- Las pruebas funcionales usan datos reales, pero se ejecutan dentro de
-- transacciones con ROLLBACK.
-- ============================================================================


-- ════════ SECCIÓN 1 — ESTRUCTURA Y PERMISOS ════════

-- 1.1 Tablas + clave de idempotencia.
select
  to_regclass('public.ronda_alertas')               is not null as t_alertas_ok,
  to_regclass('public.ronda_alerta_intervenciones') is not null as t_hist_ok,
  exists (
    select 1
    from pg_constraint
    where conname = 'ronda_alertas_ventana_key'
  ) as unique_ventana_ok;

-- 1.2 RLS activa.
select relname, relrowsecurity
from pg_class
where relname in ('ronda_alertas', 'ronda_alerta_intervenciones')
order by relname;

-- 1.3 Funciones + propiedades.
select
  p.proname,
  p.prosecdef as security_definer,
  p.provolatile as volatility
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'evaluar_ronda_alertas',
    'listar_ronda_alertas_objetivo',
    'resolver_ronda_alerta',
    'cerrar_ronda_bloqueada'
  )
order by p.proname;

-- 1.4 Grants.
select
  has_function_privilege(
    'authenticated',
    'public.evaluar_ronda_alertas()',
    'execute'
  ) as evaluar_auth,

  has_function_privilege(
    'authenticated',
    'public.listar_ronda_alertas_objetivo(uuid, text)',
    'execute'
  ) as listar_auth,

  has_function_privilege(
    'authenticated',
    'public.resolver_ronda_alerta(uuid, text, text)',
    'execute'
  ) as resolver_auth,

  has_function_privilege(
    'anon',
    'public.resolver_ronda_alerta(uuid, text, text)',
    'execute'
  ) as resolver_anon;

-- Esperado:
-- evaluar_auth = false
-- listar_auth = true
-- resolver_auth = true
-- resolver_anon = false

-- 1.5 Auto-resolución en cerrar_ronda_bloqueada.
select
  pg_get_functiondef(
    to_regprocedure('public.cerrar_ronda_bloqueada(uuid, text)')
  ) ilike '%ronda_alertas%' as cierre_auto_resuelve;


-- ════════ SECCIÓN 2 — DETECCIÓN E IDEMPOTENCIA ════════

select public.evaluar_ronda_alertas() as afectadas_1;

select
  count(*) as total_tras_1,
  count(*) filter (where tipo = 'no_iniciada') as no_iniciada,
  count(*) filter (where tipo = 'no_finalizada') as no_finalizada
from public.ronda_alertas;

select public.evaluar_ronda_alertas() as afectadas_2;

select count(*) as total_tras_2
from public.ronda_alertas;

-- Ninguna ventana debe tener dos alertas pendientes de tipos contradictorios.
select count(*) as ventanas_contradictorias
from (
  select ronda_base_id, turno_id, ventana_inicio
  from public.ronda_alertas
  where estado = 'pendiente'
  group by ronda_base_id, turno_id, ventana_inicio
  having count(distinct tipo) > 1
) x;


-- ════════ SECCIÓN 3 — DATOS DISPONIBLES PARA PRUEBA ════════

select
  a.id as alerta_id,
  a.tipo,
  a.estado,
  a.objetivo_id,
  a.ejecucion_id,
  u.auth_user_id as supervisor_auth_user_id
from public.ronda_alertas a
join public.objetivos o
  on o.id = a.objetivo_id
join public.supervisor_zonas sz
  on sz.zona_id = o.zona_id
join public.usuarios u
  on u.id = sz.supervisor_id
where a.estado = 'pendiente'
  and u.rol = 'supervisor'
  and u.estado = 'activo'
  and u.auth_user_id is not null
order by a.detectada_at desc
limit 10;


-- ════════ SECCIÓN 4 — PRUEBAS FUNCIONALES AUTOMÁTICAS ════════

-- 4.1 llamada_vigilador:
-- registra intervención pero mantiene la alerta pendiente.

begin;

do $$
declare
  v_alerta_id uuid;
  v_supervisor_auth_user_id uuid;
  v_resultado jsonb;
  v_estado text;
  v_historial integer;
begin
  select
    a.id,
    u.auth_user_id
  into
    v_alerta_id,
    v_supervisor_auth_user_id
  from public.ronda_alertas a
  join public.objetivos o
    on o.id = a.objetivo_id
  join public.supervisor_zonas sz
    on sz.zona_id = o.zona_id
  join public.usuarios u
    on u.id = sz.supervisor_id
  where a.estado = 'pendiente'
    and u.rol = 'supervisor'
    and u.estado = 'activo'
    and u.auth_user_id is not null
  order by a.detectada_at desc
  limit 1;

  if v_alerta_id is null or v_supervisor_auth_user_id is null then
    raise notice '4.1 OMITIDA: no hay alerta pendiente con supervisor autorizado.';
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_supervisor_auth_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  v_resultado := public.resolver_ronda_alerta(
    v_alerta_id,
    'llamada_vigilador',
    'Llamé al vigilador'
  )::jsonb;

  select estado
  into v_estado
  from public.ronda_alertas
  where id = v_alerta_id;

  select count(*)
  into v_historial
  from public.ronda_alerta_intervenciones
  where ronda_alerta_id = v_alerta_id;

  raise notice '4.1 resultado=% estado=% historial=%',
    v_resultado,
    v_estado,
    v_historial;
end
$$;

rollback;


-- 4.2 comentario obligatorio para justificación.

begin;

do $$
declare
  v_alerta_id uuid;
  v_supervisor_auth_user_id uuid;
  v_resultado jsonb;
begin
  select
    a.id,
    u.auth_user_id
  into
    v_alerta_id,
    v_supervisor_auth_user_id
  from public.ronda_alertas a
  join public.objetivos o
    on o.id = a.objetivo_id
  join public.supervisor_zonas sz
    on sz.zona_id = o.zona_id
  join public.usuarios u
    on u.id = sz.supervisor_id
  where a.estado = 'pendiente'
    and u.rol = 'supervisor'
    and u.estado = 'activo'
    and u.auth_user_id is not null
  order by a.detectada_at desc
  limit 1;

  if v_alerta_id is null or v_supervisor_auth_user_id is null then
    raise notice '4.2 OMITIDA: no hay alerta pendiente con supervisor autorizado.';
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_supervisor_auth_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  v_resultado := public.resolver_ronda_alerta(
    v_alerta_id,
    'justificacion',
    ''
  )::jsonb;

  raise notice '4.2 resultado=%', v_resultado;
end
$$;

rollback;


-- 4.3 justificación resuelve la alerta.

begin;

do $$
declare
  v_alerta_id uuid;
  v_supervisor_auth_user_id uuid;
  v_resultado jsonb;
  v_estado text;
  v_accion text;
  v_resuelta_at timestamptz;
begin
  select
    a.id,
    u.auth_user_id
  into
    v_alerta_id,
    v_supervisor_auth_user_id
  from public.ronda_alertas a
  join public.objetivos o
    on o.id = a.objetivo_id
  join public.supervisor_zonas sz
    on sz.zona_id = o.zona_id
  join public.usuarios u
    on u.id = sz.supervisor_id
  where a.estado = 'pendiente'
    and u.rol = 'supervisor'
    and u.estado = 'activo'
    and u.auth_user_id is not null
  order by a.detectada_at desc
  limit 1;

  if v_alerta_id is null or v_supervisor_auth_user_id is null then
    raise notice '4.3 OMITIDA: no hay alerta pendiente con supervisor autorizado.';
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_supervisor_auth_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  v_resultado := public.resolver_ronda_alerta(
    v_alerta_id,
    'justificacion',
    'Corte de energía, justificado'
  )::jsonb;

  select estado, accion, resuelta_at
  into v_estado, v_accion, v_resuelta_at
  from public.ronda_alertas
  where id = v_alerta_id;

  raise notice '4.3 resultado=% estado=% accion=% resuelta_at=%',
    v_resultado,
    v_estado,
    v_accion,
    v_resuelta_at;
end
$$;

rollback;


-- 4.4 cierre administrativo sobre una no_iniciada sin ejecución.

begin;

do $$
declare
  v_alerta_id uuid;
  v_supervisor_auth_user_id uuid;
  v_resultado jsonb;
begin
  select
    a.id,
    u.auth_user_id
  into
    v_alerta_id,
    v_supervisor_auth_user_id
  from public.ronda_alertas a
  join public.objetivos o
    on o.id = a.objetivo_id
  join public.supervisor_zonas sz
    on sz.zona_id = o.zona_id
  join public.usuarios u
    on u.id = sz.supervisor_id
  where a.estado = 'pendiente'
    and a.tipo = 'no_iniciada'
    and a.ejecucion_id is null
    and u.rol = 'supervisor'
    and u.estado = 'activo'
    and u.auth_user_id is not null
  order by a.detectada_at desc
  limit 1;

  if v_alerta_id is null or v_supervisor_auth_user_id is null then
    raise notice '4.4 OMITIDA: no hay alerta no_iniciada sin ejecución apta.';
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_supervisor_auth_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  v_resultado := public.resolver_ronda_alerta(
    v_alerta_id,
    'cierre_administrativo',
    'Motivo suficiente para prueba'
  )::jsonb;

  raise notice '4.4 resultado=%', v_resultado;
end
$$;

rollback;


-- ════════ ACEPTACIÓN ════════
-- Esperado:
--
-- 1. Tablas existentes, RLS activa y unique_ventana_ok=true.
-- 2. Las 4 funciones deben ser SECURITY DEFINER.
-- 3. evaluar_auth=false.
-- 4. listar_auth=true.
-- 5. resolver_auth=true.
-- 6. resolver_anon=false.
-- 7. cierre_auto_resuelve=true.
-- 8. total_tras_2 debe ser igual a total_tras_1.
-- 9. ventanas_contradictorias=0.
-- 10. 4.1: estado pendiente y al menos una intervención.
-- 11. 4.2: resultado con comentario_requerido.
-- 12. 4.3: estado resuelta.
-- 13. 4.4: resultado con cierre_no_aplicable.