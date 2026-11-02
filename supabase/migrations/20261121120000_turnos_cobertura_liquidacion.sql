-- ============================================================================
-- SIN APLICAR — requiere autorización expresa antes de correr en producción.
-- Turnos, cobertura y horas liquidables (Fase 2, auditoría 10/2026)
-- ============================================================================
--
-- Diagnóstico completo: docs/auditoria-2026-10/turnos_cobertura_liquidacion.md
-- Pruebas: supabase/pruebas/turnos-cobertura/run.mjs (PGlite)
-- Rollback: supabase/rollback/20261121120000_turnos_cobertura_liquidacion_rollback.sql
--
-- Definiciones vivas leídas el 02/11/2026 (pg_get_functiondef / pg_policies /
-- pg_trigger): en `turnos` sólo hay dos triggers (turnos_completar_puesto,
-- turnos_updated_at) y ninguno valida superposición ni audita; en
-- `registros_asistencia` sólo los de alerta/salida anticipada. Las políticas
-- RLS permiten INSERT/UPDATE directos (PostgREST) a quien alcanza el objetivo y
-- al vigilador sobre SUS registros, sin restricción de columnas.
--
-- Qué agrega (no modifica ninguna función ni migración existente):
--
--  1. turnos.reemplaza_turno_id — vínculo explícito "este turno cubre a aquel".
--  2. turnos_historial — auditoría APPEND-ONLY de todo INSERT/UPDATE/DELETE de
--     turnos, por trigger (cubre también las escrituras directas desde la app,
--     que hoy no dejan rastro). No tiene FK a turnos: sobrevive al borrado
--     (turnos_auditoria tiene ON DELETE CASCADE).
--  3. turnos_validar_superposicion — BEFORE INSERT/UPDATE: el mismo vigilador
--     no puede tener dos turnos con obligación que se superpongan (excluye
--     reemplazado/anulado/cancelado y objetivos pausados, igual que
--     asignar_vigilador_turnos). Es la única regla que BLOQUEA; traslado entre
--     objetivos, doble turno y descanso son advertencias de la app
--     (lib/validacion-turnos.ts). Sólo se evalúa cuando cambia guardia, fecha,
--     horario, objetivo o el turno vuelve a tener obligación: los pares
--     superpuestos heredados no traban otras operaciones.
--     Excepción (integración #346): la superposición confirmada con motivo por
--     alcance 'todas' en turnos_conflictos_confirmados no se bloquea.
--  4. asistencia_excepciones_autorizadas + autorizar_excepcion_asistencia —
--     excepción explícita (rol, motivo, quién, cuándo), de un solo uso, para
--     confirmar horas sin evidencia.
--  5. registros_asistencia_validar_liquidable — BEFORE INSERT/UPDATE: toda
--     asistencia con horas liquidables y SIN fichaje propio (confirmación de
--     supervisor/admin, carga manual, cierre con tramos) exige evidencia del
--     turno (fotos de ingreso o rondas del vigilador, o una supervisión cargada
--     en el objetivo durante el turno) o una excepción
--     autorizada vigente; y NUNCA puede liquidar un intervalo que ya cubre un
--     reemplazo con evidencia (doble liquidación). Además, las columnas que
--     definen horas liquidables no se escriben por PostgREST directo: sólo por
--     las RPC (SECURITY DEFINER) o el servicio.
--  6. turno_coberturas / cobertura_real_turno / detectar_doble_liquidacion —
--     cobertura real de un turno incluyendo reemplazos, misma regla que
--     lib/cobertura-turnos.ts.
--
-- Fechas: los turnos guardan fecha + hora local Argentina; un turno cuyo fin
-- no es posterior al inicio termina al día siguiente y pertenece al día de
-- inicio. Los instantes (created_at, vencimientos) se comparan en
-- America/Argentina/Buenos_Aires.
--
-- Impacto operativo (ver doc, "Despliegue"): desde que se aplique, confirmar
-- asistencia / cobertura sin evidencia requiere antes la excepción autorizada.
-- La app debe tener el paso de autorización listo ANTES de aplicar.

begin;

-- ── 1. Vínculo explícito de reemplazo ──────────────────────────────────────
alter table public.turnos
  add column if not exists reemplaza_turno_id uuid references public.turnos(id) on delete set null;
create index if not exists turnos_reemplaza_turno_id_idx
  on public.turnos (reemplaza_turno_id) where reemplaza_turno_id is not null;
create index if not exists turnos_guardia_fecha_cobertura_idx on public.turnos (guardia_id, fecha);
create index if not exists turnos_puesto_fecha_cobertura_idx on public.turnos (puesto_id, fecha);

comment on column public.turnos.reemplaza_turno_id is
  'Turno cuya obligación cubre este (reemplazo/relevo). Lo usa cobertura_real_turno para no liquidar dos veces el mismo intervalo.';

-- ── 2. Historial append-only de turnos ─────────────────────────────────────
create table if not exists public.turnos_historial (
  id               bigint generated always as identity primary key,
  turno_id         uuid not null,
  operacion        text not null check (operacion in ('INSERT', 'UPDATE', 'DELETE')),
  campos_cambiados text[] not null default '{}',
  antes            jsonb,
  despues          jsonb,
  actor_auth_uid   uuid,
  actor_usuario_id uuid,
  actor_db_role    text not null,
  registrado_at    timestamptz not null default now(),
  txid             bigint not null default txid_current()
);
create index if not exists turnos_historial_turno_idx on public.turnos_historial (turno_id, registrado_at);

alter table public.turnos_historial enable row level security;
revoke all on public.turnos_historial from public, anon, authenticated;
grant select on public.turnos_historial to authenticated;
grant select on public.turnos_historial to service_role;
drop policy if exists turnos_historial_lectura_alcance on public.turnos_historial;
create policy turnos_historial_lectura_alcance on public.turnos_historial
  for select to authenticated
  using (public.alcanza_objetivo_actual(coalesce((despues ->> 'objetivo_id')::uuid, (antes ->> 'objetivo_id')::uuid)));

create or replace function public.turnos_historial_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'turnos_historial es append-only: no se modifica ni se borra (%).', tg_op;
end $$;

drop trigger if exists turnos_historial_sin_update_delete on public.turnos_historial;
create trigger turnos_historial_sin_update_delete
  before update or delete on public.turnos_historial
  for each row execute function public.turnos_historial_inmutable();
drop trigger if exists turnos_historial_sin_truncate on public.turnos_historial;
create trigger turnos_historial_sin_truncate
  before truncate on public.turnos_historial
  for each statement execute function public.turnos_historial_inmutable();

-- Escritor único. Sólo acepta llamadas desde un trigger (pg_trigger_depth):
-- un cliente que lo invoque por RPC no puede fabricar historial.
create or replace function public._turnos_historial_insertar(
  p_turno_id uuid, p_operacion text, p_campos text[], p_antes jsonb, p_despues jsonb, p_rol_db text)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_usuario uuid;
begin
  if pg_trigger_depth() < 1 then
    raise exception 'turnos_historial sólo se escribe desde el trigger de turnos';
  end if;
  if v_uid is not null then
    select u.id into v_usuario from public.usuarios u where u.auth_user_id = v_uid limit 1;
  end if;
  insert into public.turnos_historial
    (turno_id, operacion, campos_cambiados, antes, despues, actor_auth_uid, actor_usuario_id, actor_db_role)
  values (p_turno_id, p_operacion, coalesce(p_campos, '{}'), p_antes, p_despues, v_uid, v_usuario, p_rol_db);
end $$;
revoke all on function public._turnos_historial_insertar(uuid, text, text[], jsonb, jsonb, text) from public, anon;
grant execute on function public._turnos_historial_insertar(uuid, text, text[], jsonb, jsonb, text) to authenticated, service_role;

-- SECURITY INVOKER a propósito: current_user distingue una escritura directa
-- de PostgREST ('authenticated') de una hecha dentro de una RPC (dueño).
create or replace function public.turnos_registrar_historial()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
declare
  v_antes jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_despues jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_campos text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into v_campos
    from jsonb_object_keys(v_despues) k
    where k <> 'updated_at' and (v_despues -> k) is distinct from (v_antes -> k);
    if cardinality(v_campos) = 0 then
      return null;
    end if;
  end if;
  perform public._turnos_historial_insertar(
    coalesce((v_despues ->> 'id')::uuid, (v_antes ->> 'id')::uuid), tg_op, v_campos, v_antes, v_despues, current_user::text);
  return null;
end $$;

drop trigger if exists turnos_historial_registrar on public.turnos;
create trigger turnos_historial_registrar
  after insert or update or delete on public.turnos
  for each row execute function public.turnos_registrar_historial();

-- ── 3. Superposición del mismo vigilador (autoridad en base) ───────────────
-- Superposición ya confirmada con motivo por alcance 'todas' (programación,
-- 20261113110000): constancia append-only en turnos_conflictos_confirmados,
-- escrita sólo por asignar_vigilador_turnos / corregir_turno_programacion /
-- el servidor, ANTES del update que la produce. Vale sólo para ese par de
-- turnos y ese vigilador. SQL dinámico: si la tabla no existe (programación
-- sin aplicar) no hay excepción y el trigger bloquea como siempre.
create or replace function public._turnos_superposicion_confirmada(p_guardia_id uuid, p_turno_a uuid, p_turno_b uuid)
returns boolean
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_ok boolean := false;
begin
  if to_regclass('public.turnos_conflictos_confirmados') is null then
    return false;
  end if;
  execute 'select exists (select 1 from public.turnos_conflictos_confirmados c
             where c.tipo = ''superposicion'' and c.guardia_id = $1
               and ((c.turno_id = $2 and c.turno_conflicto_id = $3)
                 or (c.turno_id = $3 and c.turno_conflicto_id = $2)))'
    into v_ok using p_guardia_id, p_turno_a, p_turno_b;
  return coalesce(v_ok, false);
end $$;
revoke all on function public._turnos_superposicion_confirmada(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.turnos_validar_superposicion()
returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_ini timestamp;
  v_fin timestamp;
  v_conf record;
  v_ref record;
  v_sin_obligacion constant text[] := array['reemplazado', 'anulado', 'cancelado'];
begin
  -- Vínculo de reemplazo coherente: mismo objetivo, otro turno, se superpone.
  if new.reemplaza_turno_id is not null
     and (tg_op = 'INSERT' or new.reemplaza_turno_id is distinct from old.reemplaza_turno_id
          or new.fecha is distinct from old.fecha or new.hora_inicio is distinct from old.hora_inicio
          or new.hora_fin is distinct from old.hora_fin or new.objetivo_id is distinct from old.objetivo_id) then
    select t.* into v_ref from public.turnos t where t.id = new.reemplaza_turno_id;
    if not found or v_ref.id = new.id or v_ref.objetivo_id is distinct from new.objetivo_id
       or not ((v_ref.fecha + v_ref.hora_inicio) < (new.fecha + new.hora_fin + case when new.hora_fin <= new.hora_inicio then interval '1 day' else interval '0 day' end)
               and (new.fecha + new.hora_inicio) < (v_ref.fecha + v_ref.hora_fin + case when v_ref.hora_fin <= v_ref.hora_inicio then interval '1 day' else interval '0 day' end)) then
      raise exception 'REEMPLAZO_INVALIDO: el turno reemplazado debe ser otro turno del mismo objetivo que se superponga en horario';
    end if;
  end if;

  if new.guardia_id is null or coalesce(new.estado, '') = any (v_sin_obligacion)
     or new.fecha is null or new.hora_inicio is null or new.hora_fin is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.guardia_id is not distinct from old.guardia_id
     and new.fecha is not distinct from old.fecha
     and new.hora_inicio is not distinct from old.hora_inicio
     and new.hora_fin is not distinct from old.hora_fin
     and new.objetivo_id is not distinct from old.objetivo_id
     and not (coalesce(old.estado, '') = any (v_sin_obligacion)) then
    return new;
  end if;

  -- Objetivo pausado: sus turnos no generan obligación (mismo criterio que
  -- asignar_vigilador_turnos y lib/turnos.ts).
  if not exists (select 1 from public.objetivos o where o.id = new.objetivo_id and o.estado = 'activo') then
    return new;
  end if;

  -- Serializa altas concurrentes del mismo vigilador.
  perform pg_advisory_xact_lock(hashtextextended('turnos_superposicion:' || new.guardia_id::text, 0));

  v_ini := new.fecha + new.hora_inicio;
  v_fin := new.fecha + new.hora_fin + case when new.hora_fin <= new.hora_inicio then interval '1 day' else interval '0 day' end;

  select t2.id, t2.fecha, t2.hora_inicio, t2.hora_fin, o2.nombre as objetivo
    into v_conf
  from public.turnos t2
  join public.objetivos o2 on o2.id = t2.objetivo_id
  where t2.guardia_id = new.guardia_id
    and t2.id <> new.id
    and coalesce(t2.estado, '') <> all (v_sin_obligacion)
    and o2.estado = 'activo'
    and t2.fecha between new.fecha - 1 and new.fecha + 1
    and (t2.fecha + t2.hora_inicio) < v_fin
    and v_ini < (t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end)
    -- Integración con programación (20261113110000): una superposición que
    -- alcance 'todas' confirmó con motivo no se bloquea (ver la función de abajo).
    and not public._turnos_superposicion_confirmada(new.guardia_id, new.id, t2.id)
  order by t2.fecha, t2.hora_inicio
  limit 1;

  if found then
    raise exception using
      errcode = '23P01',
      message = format('TURNO_SUPERPUESTO: el vigilador ya tiene un turno en %s el %s de %s a %s.',
                       v_conf.objetivo, v_conf.fecha, to_char(v_conf.hora_inicio, 'HH24:MI'), to_char(v_conf.hora_fin, 'HH24:MI')),
      detail = jsonb_build_object('turno_conflicto_id', v_conf.id)::text;
  end if;
  return new;
end $$;

drop trigger if exists turnos_validar_superposicion on public.turnos;
create trigger turnos_validar_superposicion
  before insert or update of guardia_id, fecha, hora_inicio, hora_fin, estado, objetivo_id, reemplaza_turno_id
  on public.turnos
  for each row execute function public.turnos_validar_superposicion();

-- ── 4. Excepciones autorizadas para confirmar sin evidencia ────────────────
create table if not exists public.asistencia_excepciones_autorizadas (
  id                    uuid primary key default gen_random_uuid(),
  operacion_id          uuid not null unique,
  turno_id              uuid not null references public.turnos(id),
  guardia_id            uuid not null references public.usuarios(id),
  motivo                text not null check (char_length(btrim(motivo)) >= 20),
  autorizado_por        uuid not null references public.usuarios(id),
  autorizado_rol        text not null,
  autorizado_at         timestamptz not null default now(),
  vence_at              timestamptz not null default now() + interval '48 hours',
  consumida_registro_id uuid,
  consumida_at          timestamptz
);
create index if not exists asistencia_excepciones_turno_idx
  on public.asistencia_excepciones_autorizadas (turno_id, guardia_id) where consumida_registro_id is null;

alter table public.asistencia_excepciones_autorizadas enable row level security;
revoke all on public.asistencia_excepciones_autorizadas from public, anon, authenticated;
grant select on public.asistencia_excepciones_autorizadas to authenticated;
drop policy if exists asistencia_excepciones_lectura_alcance on public.asistencia_excepciones_autorizadas;
create policy asistencia_excepciones_lectura_alcance on public.asistencia_excepciones_autorizadas
  for select to authenticated using (public.alcanza_turno_actual(turno_id));

-- Una excepción sólo cambia una vez: cuando se consume. Nada más se edita ni se borra.
create or replace function public.asistencia_excepciones_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las excepciones autorizadas no se borran';
  end if;
  if old.consumida_registro_id is not null
     or new.consumida_registro_id is null
     or (to_jsonb(new) - 'consumida_registro_id' - 'consumida_at') is distinct from (to_jsonb(old) - 'consumida_registro_id' - 'consumida_at') then
    raise exception 'Una excepción autorizada sólo admite registrar su único consumo';
  end if;
  return new;
end $$;
drop trigger if exists asistencia_excepciones_inmutable on public.asistencia_excepciones_autorizadas;
create trigger asistencia_excepciones_inmutable
  before update or delete on public.asistencia_excepciones_autorizadas
  for each row execute function public.asistencia_excepciones_inmutable();

alter table public.registros_asistencia
  add column if not exists excepcion_asistencia_id uuid references public.asistencia_excepciones_autorizadas(id);

-- Quién puede autorizar: jefatura operativa, administración, gerencia (o admin
-- sin puesto). Un supervisor de zona NO se autoriza a sí mismo.
-- DECISIÓN DE GERENCIA PENDIENTE: confirmar esta lista antes de aplicar.
create or replace function public.puede_autorizar_excepcion_asistencia(p_usuario_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = p_usuario_id and u.estado = 'activo'
      and ( u.puesto_organizacional in ('jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia')
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') ))
$$;
revoke all on function public.puede_autorizar_excepcion_asistencia(uuid) from public, anon;
grant execute on function public.puede_autorizar_excepcion_asistencia(uuid) to authenticated, service_role;

-- Para la pantalla: ¿el usuario de la sesión puede autorizar? (identidad desde auth.uid()).
create or replace function public.puedo_autorizar_excepcion_asistencia()
returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select public.puede_autorizar_excepcion_asistencia(u.id) from public.usuarios u
                   where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1), false)
$$;
revoke all on function public.puedo_autorizar_excepcion_asistencia() from public, anon;
grant execute on function public.puedo_autorizar_excepcion_asistencia() to authenticated;

create or replace function public.autorizar_excepcion_asistencia(
  p_operacion_id uuid, p_turno_id uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_usuario public.usuarios%rowtype;
  v_turno public.turnos%rowtype;
  v_exc public.asistencia_excepciones_autorizadas%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_operacion_id is null then raise exception 'p_operacion_id es obligatorio'; end if;

  select u.* into v_usuario from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo' limit 1;
  if not found or not public.puede_autorizar_excepcion_asistencia(v_usuario.id) then
    raise exception 'No autorizado: la excepción la autoriza jefatura operativa, administración o gerencia';
  end if;

  -- Idempotencia por operación.
  select e.* into v_exc from public.asistencia_excepciones_autorizadas e where e.operacion_id = p_operacion_id;
  if found then
    if v_exc.turno_id <> p_turno_id or v_exc.autorizado_por <> v_usuario.id or v_exc.motivo <> coalesce(v_motivo, '') then
      raise exception 'operacion_id ya utilizado con otro contexto';
    end if;
    return jsonb_build_object('estado', 'existente', 'excepcion_id', v_exc.id, 'vence_at', v_exc.vence_at);
  end if;

  if v_motivo is null or char_length(v_motivo) < 20 then
    raise exception 'El motivo es obligatorio (mínimo 20 caracteres): qué se verificó y por qué no hay evidencia';
  end if;

  select t.* into v_turno from public.turnos t where t.id = p_turno_id for update;
  if not found then raise exception 'Turno no encontrado'; end if;
  if not public.alcanza_objetivo(v_usuario.id, v_turno.objetivo_id) then
    raise exception 'No autorizado para este objetivo';
  end if;
  if coalesce(v_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    raise exception 'El turno ya no admite mutaciones operativas por su estado: %', v_turno.estado;
  end if;
  if v_turno.guardia_id is null then
    raise exception 'El turno no tiene vigilador asignado';
  end if;

  insert into public.asistencia_excepciones_autorizadas
    (operacion_id, turno_id, guardia_id, motivo, autorizado_por, autorizado_rol)
  values (p_operacion_id, v_turno.id, v_turno.guardia_id, v_motivo, v_usuario.id,
          coalesce(v_usuario.puesto_organizacional, v_usuario.rol))
  returning * into v_exc;

  return jsonb_build_object('estado', 'creada', 'excepcion_id', v_exc.id, 'vence_at', v_exc.vence_at);
exception when unique_violation then
  select e.* into v_exc from public.asistencia_excepciones_autorizadas e where e.operacion_id = p_operacion_id;
  if found and v_exc.turno_id = p_turno_id and v_exc.autorizado_por = v_usuario.id then
    return jsonb_build_object('estado', 'existente', 'excepcion_id', v_exc.id, 'vence_at', v_exc.vence_at);
  end if;
  raise;
end $$;
revoke all on function public.autorizar_excepcion_asistencia(uuid, uuid, text) from public, anon;
grant execute on function public.autorizar_excepcion_asistencia(uuid, uuid, text) to authenticated, service_role;

-- ── 6 (antes que 5: el trigger las usa). Evidencia, horas y cobertura ──────

-- Tipo de evidencia de presencia de un vigilador en un turno.
--   fichaje              registro propio con hora_entrada_real (GPS/app)
--   foto_o_ronda         fotos de ingreso (evidencias) o rondas del vigilador en el turno
--   constatacion_supervisor  una supervisión cargada en el objetivo DURANTE el
--                        turno: el supervisor constató la cobertura en el lugar.
--                        El comentario de una confirmación (supervisor_intervenciones)
--                        NO cuenta: no prueba presencia en el puesto.
--   excepcion_autorizada asistencia con excepción autorizada consumida
--   sin_evidencia        hay asistencia liquidable pero nada que la respalde
--   sin_registro         no hay asistencia
create or replace function public.asistencia_evidencia_tipo(p_turno_id uuid, p_guardia_id uuid)
returns text language sql stable security definer set search_path = public, pg_catalog as $$
  select case
    when exists (select 1 from public.registros_asistencia r
                 where r.turno_id = p_turno_id and coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id
                   and coalesce(r.tipo_registro, '') <> 'ausencia' and r.hora_entrada_real is not null
                   and r.registro_anulado_at is null and r.cobertura_anulada_at is null) then 'fichaje'
    when exists (select 1 from public.evidencias e where e.turno_id = p_turno_id and e.guardia_id = p_guardia_id)
      or exists (select 1 from public.ronda_ejecuciones x where x.turno_id = p_turno_id and x.guardia_id = p_guardia_id
                   and x.iniciada_at is not null) then 'foto_o_ronda'
    when exists (select 1 from public.turnos t
                 join public.supervisiones s on s.objetivo_id = t.objetivo_id
                 where t.id = p_turno_id
                   and s.created_at >= (t.fecha + t.hora_inicio) at time zone 'America/Argentina/Buenos_Aires'
                   and s.created_at <= (t.fecha + t.hora_fin
                                        + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0 day' end)
                                       at time zone 'America/Argentina/Buenos_Aires') then 'constatacion_supervisor'
    when exists (select 1 from public.registros_asistencia r
                 where r.turno_id = p_turno_id and coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id
                   and r.excepcion_asistencia_id is not null
                   and r.registro_anulado_at is null and r.cobertura_anulada_at is null) then 'excepcion_autorizada'
    when exists (select 1 from public.registros_asistencia r
                 where r.turno_id = p_turno_id and coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id
                   and coalesce(r.tipo_registro, '') <> 'ausencia'
                   and r.registro_anulado_at is null and r.cobertura_anulada_at is null) then 'sin_evidencia'
    else 'sin_registro' end
$$;
revoke all on function public.asistencia_evidencia_tipo(uuid, uuid) from public, anon;

-- Horas liquidables de un vigilador en un turno, misma regla que
-- lib/liquidacion.ts (selectRegistroPrincipal + horasLiquidablesRegistro):
--   1. horas_liquidables guardadas (normalizadas a 0,5)
--   2. tiempos _final → calcular_horas_liquidables (normalizado a 0,5)
--   3. fichaje completo → duración programada
--   4. si no, 0.  (La regla de transición jun/jul 2026 no aplica a este período.)
create or replace function public.turno_horas_liquidadas(p_turno_id uuid, p_guardia_id uuid)
returns numeric language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_t public.turnos%rowtype;
  v_r public.registros_asistencia%rowtype;
  v_ent time;
  v_sal time;
begin
  select * into v_t from public.turnos where id = p_turno_id;
  if not found or coalesce(v_t.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
    return 0;
  end if;
  select r.* into v_r
  from public.registros_asistencia r
  where r.turno_id = p_turno_id
    and coalesce(r.tipo_registro, '') <> 'ausencia'
    and r.registro_anulado_at is null
    and (p_guardia_id is null or coalesce(r.guardia_final_id, r.guardia_id) = p_guardia_id)
  order by
    case when r.cobertura_anulada_at is not null then -1000 else
      (case when r.horas_liquidables is not null then 100 else 0 end)
      + (case when r.hora_entrada_final is not null or r.hora_salida_final is not null then 40 else 0 end)
      + (case when r.hora_entrada_real is not null then 10 else 0 end)
      + (case when r.hora_salida_real is not null then 5 else 0 end)
      + least(coalesce(r.horas_trabajadas, 0), 24) end desc,
    (coalesce(r.hora_salida_final, r.hora_salida_real) is not null) desc,
    (coalesce(r.hora_entrada_final, r.hora_entrada_real) is not null) desc,
    coalesce(r.horas_liquidables, 0) desc,
    r.id::text
  limit 1;
  if not found or v_r.cobertura_anulada_at is not null then
    return 0;
  end if;
  if v_r.horas_liquidables is not null then
    return round(greatest(0, v_r.horas_liquidables) * 2) / 2;
  end if;
  if v_r.hora_entrada_final is not null or v_r.hora_salida_final is not null then
    v_ent := coalesce(v_r.hora_entrada_final, v_r.hora_entrada_real);
    v_sal := coalesce(v_r.hora_salida_final, v_r.hora_salida_real);
    if v_ent is null or v_sal is null then return 0; end if;
    return round(coalesce(public.calcular_horas_liquidables(v_t.hora_inicio, v_t.hora_fin, v_ent, v_sal), 0) * 2) / 2;
  end if;
  if v_r.hora_entrada_real is not null and v_r.hora_salida_real is not null then
    return coalesce(public.calcular_horas_liquidables(v_t.hora_inicio, v_t.hora_fin, v_t.hora_inicio, v_t.hora_fin), 0);
  end if;
  return 0;
end $$;
revoke all on function public.turno_horas_liquidadas(uuid, uuid) from public, anon;

-- Titular + reemplazos de un turno. Reemplazo = otro turno del mismo puesto
-- (o del mismo objetivo si no hay puesto), de otro vigilador, con obligación,
-- que se superpone y (a) declara reemplaza_turno_id = este turno o (b) sin
-- vínculo, se creó más de 5 min después que este y no antes de 12 h previas
-- a su inicio (reemplazo armado sobre la marcha). Espejo: lib/cobertura-turnos.ts.
create or replace function public.turno_coberturas(p_turno_id uuid)
returns table (
  turno_id uuid, guardia_id uuid, rol text, evidencia text,
  minutos_solapados integer, horas_liquidables numeric, horas_atribuidas numeric,
  inicio timestamp, fin timestamp)
language sql stable security definer set search_path = public, pg_catalog as $$
  with b as (
    select t.*, (t.fecha + t.hora_inicio) as ini,
           (t.fecha + t.hora_fin + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0 day' end) as fin_b
    from public.turnos t where t.id = p_turno_id
  ),
  c as (
    select t2.id, t2.guardia_id,
           greatest(b.ini, t2.fecha + t2.hora_inicio) as i,
           least(b.fin_b, t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end) as f,
           extract(epoch from (t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end)
                              - (t2.fecha + t2.hora_inicio)) / 60.0 as dur2
    from b
    join public.turnos t2
      on t2.id <> b.id
     and t2.guardia_id is not null
     and t2.guardia_id is distinct from b.guardia_id
     and coalesce(t2.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
     and ((b.puesto_id is not null and t2.puesto_id = b.puesto_id)
          or (b.puesto_id is null and t2.puesto_id is null and t2.objetivo_id = b.objetivo_id))
     and t2.fecha between b.fecha - 1 and b.fecha + 1
     and (t2.fecha + t2.hora_inicio) < b.fin_b
     and b.ini < (t2.fecha + t2.hora_fin + case when t2.hora_fin <= t2.hora_inicio then interval '1 day' else interval '0 day' end)
     and (t2.reemplaza_turno_id = b.id
          or (t2.reemplaza_turno_id is null
              and t2.created_at > b.created_at + interval '5 minutes'
              and t2.created_at > ((b.fecha + b.hora_inicio) at time zone 'America/Argentina/Buenos_Aires') - interval '12 hours'))
  )
  select b.id, b.guardia_id, 'titular'::text,
         case when b.guardia_id is null then 'sin_registro' else public.asistencia_evidencia_tipo(b.id, b.guardia_id) end,
         (extract(epoch from b.fin_b - b.ini) / 60)::integer,
         public.turno_horas_liquidadas(b.id, b.guardia_id),
         public.turno_horas_liquidadas(b.id, b.guardia_id),
         b.ini, b.fin_b
  from b
  union all
  select c.id, c.guardia_id, 'reemplazo'::text,
         public.asistencia_evidencia_tipo(c.id, c.guardia_id),
         (extract(epoch from c.f - c.i) / 60)::integer,
         public.turno_horas_liquidadas(c.id, c.guardia_id),
         round(public.turno_horas_liquidadas(c.id, c.guardia_id) * (extract(epoch from c.f - c.i) / 60.0) / nullif(c.dur2, 0), 2),
         c.i, c.f
  from c
$$;
revoke all on function public.turno_coberturas(uuid) from public, anon, authenticated;

-- Versión interna (sin control de alcance) de la cobertura real.
create or replace function public._cobertura_real_turno(p_turno_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_t public.turnos%rowtype;
  v_prog numeric;
  v_cubiertas numeric;
  v_liq numeric;
  v_doble numeric;
  v_titular_ev text;
  v_estado text;
  v_cob jsonb;
begin
  select * into v_t from public.turnos where id = p_turno_id;
  if not found then return null; end if;
  v_prog := round(extract(epoch from (v_t.fecha + v_t.hora_fin + case when v_t.hora_fin <= v_t.hora_inicio then interval '1 day' else interval '0 day' end)
                                     - (v_t.fecha + v_t.hora_inicio)) / 3600.0, 2);

  select coalesce(jsonb_agg(jsonb_build_object(
           'turno_id', c.turno_id, 'guardia_id', c.guardia_id, 'rol', c.rol, 'evidencia', c.evidencia,
           'minutos_solapados', c.minutos_solapados, 'horas_liquidables', c.horas_liquidables,
           'horas_atribuidas', c.horas_atribuidas) order by c.rol desc, c.inicio), '[]'::jsonb),
         round(coalesce(sum(c.horas_atribuidas), 0), 2),
         max(c.evidencia) filter (where c.rol = 'titular')
    into v_cob, v_liq, v_titular_ev
  from public.turno_coberturas(p_turno_id) c;

  select round(coalesce(sum(extract(epoch from (upper(r) - lower(r)))), 0) / 3600.0, 2) into v_cubiertas
  from unnest((
    select range_agg(tsrange(c.inicio, c.fin, '[)'))
    from public.turno_coberturas(p_turno_id) c
    where c.evidencia in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor', 'excepcion_autorizada') and c.fin > c.inicio
  )) r;

  v_doble := greatest(0, round(v_liq - v_prog, 2));
  v_estado := case
    when coalesce(v_t.estado, '') in ('reemplazado', 'anulado', 'cancelado') then 'sin_obligacion'
    when v_doble > 0.01 then 'doble_liquidacion'
    when v_cubiertas >= v_prog and v_prog > 0 then
      case when v_titular_ev in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor', 'excepcion_autorizada') then 'cubierto_titular' else 'cubierto_reemplazo' end
    when v_cubiertas > 0 then 'parcial'
    else 'descubierto' end;

  return jsonb_build_object(
    'turno_id', v_t.id, 'puesto_id', v_t.puesto_id, 'objetivo_id', v_t.objetivo_id,
    'fecha', v_t.fecha,  -- día de inicio: un nocturno pertenece a este día
    'horas_programadas', v_prog, 'horas_cubiertas_con_evidencia', v_cubiertas,
    'horas_liquidadas', v_liq, 'horas_doble_liquidacion', v_doble,
    'estado', v_estado, 'coberturas', v_cob);
end $$;
revoke all on function public._cobertura_real_turno(uuid) from public, anon, authenticated;

create or replace function public.cobertura_real_turno(p_turno_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is not null and not public.alcanza_turno_actual(p_turno_id) then
    raise exception 'No autorizado para este turno';
  end if;
  return public._cobertura_real_turno(p_turno_id);
end $$;
revoke all on function public.cobertura_real_turno(uuid) from public, anon;
grant execute on function public.cobertura_real_turno(uuid) to authenticated, service_role;

-- Reporte: turnos cuyo intervalo se liquida más de una vez en [p_desde, p_hasta]
-- (fechas de inicio, hora Argentina). Sólo operadores, dentro de su alcance.
create or replace function public.detectar_doble_liquidacion(p_desde date, p_hasta date)
returns table (
  turno_id uuid, fecha date, objetivo_id uuid, puesto_id uuid, guardia_id uuid,
  horas_programadas numeric, horas_liquidadas numeric, horas_doble numeric, coberturas jsonb)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_usuario uuid;
  v_t record;
  v_c jsonb;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 62 then
    raise exception 'Rango inválido (máximo 62 días)';
  end if;
  if v_uid is not null then
    select u.id into v_usuario from public.usuarios u where u.auth_user_id = v_uid and u.estado = 'activo';
    if v_usuario is null or not public.es_operador_actual() then
      raise exception 'No autorizado';
    end if;
  end if;
  for v_t in
    select t.id from public.turnos t
    where t.fecha between p_desde and p_hasta
      and coalesce(t.estado, '') not in ('reemplazado', 'anulado', 'cancelado')
      and (v_usuario is null or public.alcanza_objetivo(v_usuario, t.objetivo_id))
    order by t.fecha, t.hora_inicio
  loop
    v_c := public._cobertura_real_turno(v_t.id);
    if (v_c ->> 'horas_doble_liquidacion')::numeric > 0.01 then
      turno_id := v_t.id;
      fecha := (v_c ->> 'fecha')::date;
      objetivo_id := (v_c ->> 'objetivo_id')::uuid;
      puesto_id := (v_c ->> 'puesto_id')::uuid;
      guardia_id := (select t.guardia_id from public.turnos t where t.id = v_t.id);
      horas_programadas := (v_c ->> 'horas_programadas')::numeric;
      horas_liquidadas := (v_c ->> 'horas_liquidadas')::numeric;
      horas_doble := (v_c ->> 'horas_doble_liquidacion')::numeric;
      coberturas := v_c -> 'coberturas';
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.detectar_doble_liquidacion(date, date) from public, anon;
grant execute on function public.detectar_doble_liquidacion(date, date) to authenticated, service_role;

-- ── 5. Validación de toda asistencia liquidable ────────────────────────────
-- Devuelve el id de excepción a fijar en el registro (o null). Lanza error
-- si la escritura no corresponde. Sólo desde trigger.
create or replace function public._registro_liquidable_validar(
  p_op text, p_new jsonb, p_old jsonb, p_directo boolean)
returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_protegidas constant text[] := array[
    'horas_liquidables', 'origen_cobertura', 'guardia_final_id', 'objetivo_final_id',
    'hora_entrada_final', 'hora_salida_final', 'cobertura_anulada_at', 'cobertura_anulada_por',
    'cobertura_anulada_motivo', 'cobertura_intervencion_origen_id', 'cobertura_anulacion_intervencion_id',
    'horas_liquidables_antes_anulacion', 'registro_anulado_at', 'registro_anulado_por',
    'registro_anulado_motivo', 'excepcion_asistencia_id', 'cierre_automatico'];
  v_col text;
  v_new_h numeric := coalesce((p_new ->> 'horas_liquidables')::numeric, 0);
  v_old_h numeric := coalesce((p_old ->> 'horas_liquidables')::numeric, 0);
  v_exc_old uuid := (p_old ->> 'excepcion_asistencia_id')::uuid;
  v_manual boolean;
  v_t public.turnos%rowtype;
  v_guardia uuid;
  v_prog numeric;
  v_cubierto numeric;
  v_ev text;
  v_exc uuid;
begin
  if pg_trigger_depth() < 1 then
    raise exception 'Sólo se invoca desde el trigger de registros_asistencia';
  end if;

  -- a) Escrituras directas por PostgREST: no tocan columnas que definen horas
  --    liquidables. Esas pasan por RPC (registrar_cobertura, intervenciones,
  --    correcciones, anulaciones) o por el servicio.
  if p_directo then
    foreach v_col in array v_protegidas loop
      if p_op = 'INSERT' then
        if v_col = 'cierre_automatico' then
          if coalesce((p_new ->> v_col)::boolean, false) then
            raise exception 'CAMPO_PROTEGIDO: % sólo lo escribe el sistema', v_col;
          end if;
        elsif p_new ->> v_col is not null then
          raise exception 'CAMPO_PROTEGIDO: % no se carga directamente; use el circuito de supervisión', v_col;
        end if;
      elsif (p_new -> v_col) is distinct from (p_old -> v_col) then
        raise exception 'CAMPO_PROTEGIDO: % no se modifica directamente; use el circuito de supervisión', v_col;
      end if;
    end loop;
    if p_op = 'INSERT' and coalesce(p_new ->> 'tipo_registro', 'fichaje_gps') <> 'fichaje_gps' then
      raise exception 'CAMPO_PROTEGIDO: un registro directo sólo puede ser un fichaje';
    end if;
    if p_op = 'UPDATE' and ((p_new -> 'tipo_registro') is distinct from (p_old -> 'tipo_registro')
                            or (p_new -> 'turno_id') is distinct from (p_old -> 'turno_id')
                            or (p_new -> 'guardia_id') is distinct from (p_old -> 'guardia_id')) then
      raise exception 'CAMPO_PROTEGIDO: tipo, turno y vigilador de un registro no se cambian directamente';
    end if;
  end if;

  -- b) ¿Es horas liquidables SIN fichaje propio, y nuevas o en aumento?
  v_manual := coalesce(p_new ->> 'tipo_registro', '') <> 'ausencia'
    and p_new ->> 'cobertura_anulada_at' is null
    and p_new ->> 'registro_anulado_at' is null
    and v_new_h > 0
    and p_new ->> 'hora_entrada_real' is null;
  if p_op = 'UPDATE' and v_manual and v_new_h <= v_old_h and p_old ->> 'hora_entrada_real' is null then
    v_manual := false;  -- no aumenta: corrección a la baja o cambio de otro campo
  end if;
  if not v_manual then
    return v_exc_old;
  end if;

  select * into v_t from public.turnos where id = (p_new ->> 'turno_id')::uuid;
  if not found then
    raise exception 'Turno inexistente para la asistencia';
  end if;
  v_guardia := coalesce((p_new ->> 'guardia_final_id')::uuid, (p_new ->> 'guardia_id')::uuid);

  -- c) Nunca dos veces el mismo intervalo: lo ya cubierto con evidencia por un
  --    reemplazo no se vuelve a liquidar al titular (ni con excepción).
  v_prog := round(extract(epoch from (v_t.fecha + v_t.hora_fin + case when v_t.hora_fin <= v_t.hora_inicio then interval '1 day' else interval '0 day' end)
                                     - (v_t.fecha + v_t.hora_inicio)) / 3600.0, 2);
  select coalesce(sum(c.horas_atribuidas), 0) into v_cubierto
  from public.turno_coberturas(v_t.id) c
  where c.rol = 'reemplazo' and c.evidencia in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor', 'excepcion_autorizada');
  if v_new_h + v_cubierto > v_prog + 0.01 then
    raise exception using
      errcode = 'P0001',
      message = format('DOBLE_LIQUIDACION: el turno ya está cubierto por un reemplazo con evidencia (%s h de %s h programadas); no se pueden liquidar %s h más al titular.',
                       v_cubierto, v_prog, v_new_h);
  end if;

  -- d) Evidencia del vigilador en el turno, o excepción autorizada vigente.
  if v_exc_old is not null then
    return v_exc_old;
  end if;
  v_ev := public.asistencia_evidencia_tipo(v_t.id, v_guardia);
  if v_ev in ('fichaje', 'foto_o_ronda', 'constatacion_supervisor') then
    return null;
  end if;
  select e.id into v_exc
  from public.asistencia_excepciones_autorizadas e
  where e.turno_id = v_t.id and e.guardia_id = v_guardia
    and e.consumida_registro_id is null and e.vence_at > now()
  order by e.autorizado_at desc
  limit 1
  for update;
  if v_exc is null then
    raise exception using
      errcode = 'P0001',
      message = 'CONFIRMACION_SIN_EVIDENCIA: no hay fichaje, fotos ni rondas del vigilador ni una supervisión en el objetivo durante el turno. Para confirmar horas hace falta una excepción autorizada (autorizar_excepcion_asistencia) con motivo.';
  end if;
  return v_exc;
end $$;
revoke all on function public._registro_liquidable_validar(text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public._registro_liquidable_validar(text, jsonb, jsonb, boolean) to authenticated, service_role;

-- Consume la excepción y deja la huella en registros_asistencia_auditoria.
create or replace function public._registro_excepcion_consumir(p_registro_id uuid, p_excepcion_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_e public.asistencia_excepciones_autorizadas%rowtype;
begin
  if pg_trigger_depth() < 1 then
    raise exception 'Sólo se invoca desde el trigger de registros_asistencia';
  end if;
  update public.asistencia_excepciones_autorizadas
     set consumida_registro_id = p_registro_id, consumida_at = now()
   where id = p_excepcion_id and consumida_registro_id is null
  returning * into v_e;
  if not found then
    raise exception 'La excepción autorizada ya fue usada';
  end if;
  insert into public.registros_asistencia_auditoria
    (registro_id, turno_id, modificado_por, campo, valor_anterior, valor_nuevo, comentario)
  values (p_registro_id, v_e.turno_id, v_e.autorizado_por, 'excepcion_sin_evidencia', null, v_e.id::text,
          format('Autorizada por %s (%s) el %s: %s', v_e.autorizado_por, v_e.autorizado_rol,
                 to_char(v_e.autorizado_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI'), v_e.motivo));
end $$;
revoke all on function public._registro_excepcion_consumir(uuid, uuid) from public, anon;
grant execute on function public._registro_excepcion_consumir(uuid, uuid) to authenticated, service_role;

-- Triggers SECURITY INVOKER: current_user es 'authenticated'/'anon' sólo en
-- una escritura directa de PostgREST; dentro de una RPC es el dueño.
create or replace function public.registros_asistencia_validar_liquidable()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  new.excepcion_asistencia_id := public._registro_liquidable_validar(
    tg_op, to_jsonb(new), case when tg_op = 'UPDATE' then to_jsonb(old) end,
    current_user in ('authenticated', 'anon'));
  return new;
end $$;

create or replace function public.registros_asistencia_consumir_excepcion()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.excepcion_asistencia_id is not null
     and (tg_op = 'INSERT' or new.excepcion_asistencia_id is distinct from old.excepcion_asistencia_id) then
    perform public._registro_excepcion_consumir(new.id, new.excepcion_asistencia_id);
  end if;
  return null;
end $$;

drop trigger if exists registros_asistencia_validar_liquidable on public.registros_asistencia;
create trigger registros_asistencia_validar_liquidable
  before insert or update on public.registros_asistencia
  for each row execute function public.registros_asistencia_validar_liquidable();
drop trigger if exists registros_asistencia_consumir_excepcion on public.registros_asistencia;
create trigger registros_asistencia_consumir_excepcion
  after insert or update on public.registros_asistencia
  for each row execute function public.registros_asistencia_consumir_excepcion();

commit;

-- ── Verificación (solo lectura, después de aplicar) ───────────────────────
-- 1) Triggers presentes:
--   select tgname from pg_trigger where tgrelid in ('public.turnos'::regclass, 'public.registros_asistencia'::regclass) and not tgisinternal order by 1;
-- 2) Caso Lotuf 29/10 (debe mostrar doble liquidación 8 h hasta corregir):
--   select public.cobertura_real_turno('2aeb0d2c-f203-4e1e-85d1-474a8dfba353');
-- 3) Doble liquidación de octubre:
--   select * from public.detectar_doble_liquidacion('2026-10-01', '2026-10-31');
-- 4) Ningún turno nuevo superpuesto desde la aplicación:
--   select count(*) from public.turnos_historial h where h.operacion = 'INSERT' and h.registrado_at > '<fecha de aplicación>';
