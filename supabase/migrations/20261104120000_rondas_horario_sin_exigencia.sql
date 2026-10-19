-- Rondas: horarios en que una ronda no se exige.
--
-- ── Pedido (JC, 19/10/2026) ──────────────────────────────────────────────────
-- Laromet Baigorria: los domingos desde las 06:00 el vigilador hace de portero
-- en el ingreso y no corresponden rondas, pero el turno del sábado sigue hasta
-- las 10:00 y la app le exigía las rondas de las 06 y las 08. Partir el turno
-- obligaría a fichar dos veces y a rehacerlo cada semana. En cambio, se
-- declara UNA vez en la ronda: «domingo de 06:00 a 22:00 no se exige».
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
--  · ronda_horarios_sin_exigencia: ronda, día de la semana (1=lunes … 7=domingo),
--    desde/hasta (hora argentina, mismo día; para cruzar la medianoche se
--    cargan dos filas), motivo obligatorio, quién y cuándo. No se borra: se
--    da de baja con motivo.
--  · rondas_ventanas_programadas: la ventana cuyo inicio cae en un horario
--    activo no existe como obligación. De esa función salen las alertas
--    (evaluar_ronda_alertas), la evaluación (cumplimiento_rondas_por_empleado
--    y _servicio), la lista del vigilador (obtener_rondas_guardia_actual) y la
--    del supervisor (listar_rondas_programadas_objetivo). Los avisos push y de
--    WhatsApp al vigilador, que calculan las ventanas en el servidor, leen la
--    misma tabla (mismo PR).
--  · Como la evaluación se recalcula, el horario vale también hacia atrás.
--  · Cargar o dar de baja: quien edita protocolos (Administración, Gerencia,
--    jefatura de supervisores, dirección operativa) con alcance al objetivo.
--    Ver: quien administra las rondas del objetivo.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
-- No toca turnos, fichajes, horas ni otras rondas: sin filas cargadas, la
-- función devuelve exactamente lo mismo que antes. No carga ningún horario:
-- el de Laromet se carga aparte, una vez aplicada.
-- Reglas SQL del proyecto: nada de `select col into variable`.
-- Rollback: supabase/rollback/20261104120000_rondas_horario_sin_exigencia_rollback.sql

begin;

-- ============================================================================
-- 1. TABLA
-- ============================================================================

create table if not exists public.ronda_horarios_sin_exigencia (
  id               uuid primary key default gen_random_uuid(),
  ronda_base_id    uuid not null references public.rondas_base(id) on delete restrict,
  dia_semana       smallint not null check (dia_semana between 1 and 7),
  desde            time not null,
  hasta            time not null,
  motivo           text not null check (length(btrim(motivo)) > 0),
  activo           boolean not null default true,
  creado_por       uuid references public.usuarios(id) on delete restrict,
  creado_at        timestamptz not null default now(),
  desactivado_por  uuid references public.usuarios(id) on delete restrict,
  desactivado_at   timestamptz,
  motivo_baja      text,
  constraint ronda_horario_rango check (hasta > desde),
  constraint ronda_horario_baja_completa check (
    activo or (desactivado_at is not null and length(btrim(coalesce(motivo_baja, ''))) > 0)
  )
);

create index if not exists idx_ronda_horarios_sin_exigencia_ronda
  on public.ronda_horarios_sin_exigencia (ronda_base_id) where activo;

comment on table public.ronda_horarios_sin_exigencia is
  'Dia y horario (hora argentina) en que una ronda no se exige. La ventana cuyo '
  'inicio cae adentro no genera obligacion, alerta ni cuenta en la evaluacion.';

-- Nada se borra; una vez dado de baja, no cambia.
create or replace function public.ronda_horario_proteger()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los horarios sin exigencia no se borran: darlos de baja con motivo' using errcode = '42501';
  end if;
  if not old.activo then
    raise exception 'Un horario dado de baja no se modifica' using errcode = '42501';
  end if;
  if new.ronda_base_id is distinct from old.ronda_base_id
     or new.dia_semana is distinct from old.dia_semana
     or new.desde is distinct from old.desde
     or new.hasta is distinct from old.hasta
     or new.motivo is distinct from old.motivo
     or new.creado_por is distinct from old.creado_por
     or new.creado_at is distinct from old.creado_at then
    raise exception 'Un horario sin exigencia no se edita: darlo de baja y cargar otro' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ronda_horario_proteger on public.ronda_horarios_sin_exigencia;
create trigger trg_ronda_horario_proteger
  before update or delete on public.ronda_horarios_sin_exigencia
  for each row execute function public.ronda_horario_proteger();
drop trigger if exists trg_ronda_horarios_sin_truncate on public.ronda_horarios_sin_exigencia;
create trigger trg_ronda_horarios_sin_truncate
  before truncate on public.ronda_horarios_sin_exigencia
  for each statement execute function public.protocolo_registro_inmutable();

-- ============================================================================
-- 2. PERMISOS
-- ============================================================================

alter table public.ronda_horarios_sin_exigencia enable row level security;
revoke all on table public.ronda_horarios_sin_exigencia from anon, authenticated;
grant select on table public.ronda_horarios_sin_exigencia to authenticated;

drop policy if exists "Rondas: horarios sin exigencia para quien administra la ronda" on public.ronda_horarios_sin_exigencia;
create policy "Rondas: horarios sin exigencia para quien administra la ronda"
  on public.ronda_horarios_sin_exigencia for select to authenticated
  using (exists (
    select 1 from public.rondas_base rb
    where rb.id = ronda_base_id and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
  ));

-- ============================================================================
-- 3. RPC
-- ============================================================================

create or replace function public.ronda_horario_sin_exigencia_agregar(
  p_ronda_base_id uuid,
  p_dia_semana integer,
  p_desde time,
  p_hasta time,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_objetivo uuid;
  v_id       uuid;
begin
  v_objetivo := (select rb.objetivo_id from public.rondas_base rb where rb.id = p_ronda_base_id);
  if v_objetivo is null then
    raise exception 'Ronda inexistente' using errcode = '22023';
  end if;
  if auth.uid() is null or not public.protocolo_puede_preparar() or not public.protocolo_puede_ver(v_objetivo) then
    raise exception 'No tenes permiso para cambiar cuando se exige esta ronda' using errcode = '42501';
  end if;
  if p_dia_semana is null or p_dia_semana not between 1 and 7 then
    raise exception 'Dia invalido (1 = lunes ... 7 = domingo)' using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then
    raise exception 'El horario tiene que terminar despues de empezar, el mismo dia' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ronda_horarios_sin_exigencia h
     where h.ronda_base_id = p_ronda_base_id and h.activo and h.dia_semana = p_dia_semana
       and h.desde < p_hasta and p_desde < h.hasta
  ) then
    raise exception 'Ya hay un horario cargado que se superpone ese dia' using errcode = '22023';
  end if;

  insert into public.ronda_horarios_sin_exigencia (ronda_base_id, dia_semana, desde, hasta, motivo, creado_por)
  values (p_ronda_base_id, p_dia_semana, p_desde, p_hasta, btrim(p_motivo), public.rondas_usuario_actual_id())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

create or replace function public.ronda_horario_sin_exigencia_quitar(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_h        public.ronda_horarios_sin_exigencia%rowtype;
  v_objetivo uuid;
begin
  v_h := (select h from public.ronda_horarios_sin_exigencia h where h.id = p_id);
  if v_h.id is null then
    raise exception 'Horario inexistente' using errcode = '22023';
  end if;
  v_objetivo := (select rb.objetivo_id from public.rondas_base rb where rb.id = v_h.ronda_base_id);
  if auth.uid() is null or not public.protocolo_puede_preparar() or not public.protocolo_puede_ver(v_objetivo) then
    raise exception 'No tenes permiso para cambiar cuando se exige esta ronda' using errcode = '42501';
  end if;
  if not v_h.activo then
    return jsonb_build_object('ok', true, 'ya_estaba', true);
  end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;
  update public.ronda_horarios_sin_exigencia
     set activo = false, desactivado_por = public.rondas_usuario_actual_id(),
         desactivado_at = now(), motivo_baja = btrim(p_motivo)
   where id = p_id;
  return jsonb_build_object('ok', true, 'ya_estaba', false);
end;
$fn$;

revoke all on function public.ronda_horario_sin_exigencia_agregar(uuid, integer, time, time, text) from public, anon;
revoke all on function public.ronda_horario_sin_exigencia_quitar(uuid, text) from public, anon;
grant execute on function public.ronda_horario_sin_exigencia_agregar(uuid, integer, time, time, text) to authenticated;
grant execute on function public.ronda_horario_sin_exigencia_quitar(uuid, text) to authenticated;

-- ============================================================================
-- 4. LA FUNCIÓN QUE DECIDE QUÉ VENTANAS SE EXIGEN
-- ============================================================================
-- Copia exacta de 20260827120000 (verificada contra producción el 19/10/2026,
-- md5 del cuerpo a9fd7ddd5c6f8ef739a3490ec684789e) más el bloque «Horario en
-- que la ronda no se exige».

create or replace function public.rondas_ventanas_programadas(
  p_objetivo_id uuid,            -- NULL = todos los objetivos (excluye es_prueba)
  p_desde       date,
  p_hasta       date
)
returns table (
  turno_id       uuid,
  objetivo_id    uuid,
  puesto_id      uuid,
  guardia_id     uuid,
  ronda_base_id  uuid,
  indice         integer,
  ventana_inicio timestamptz,
  ventana_fin    timestamptz,
  match_fin      timestamptz,
  vencimiento_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_tol_min int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_tolerancia_min'), 15);
  v_tol     interval;

  r_turno   record;
  r_ronda   record;
  v_t_ini   timestamp;   -- inicio del turno (local)
  v_t_fin   timestamp;   -- fin del turno (local, +1 dia si nocturno)
  v_interv  interval;
  v_base    timestamp;
  v_vi      timestamp;
  v_vf      timestamp;
  v_mf      timestamp;
  v_n       int;
begin
  v_tol := make_interval(mins => v_tol_min);

  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    return;
  end if;

  for r_turno in
    select t.id, t.fecha, t.hora_inicio, t.hora_fin,
           t.objetivo_id, t.puesto_id, t.guardia_id
    from public.turnos t
    join public.objetivos o on o.id = t.objetivo_id
    where t.puesto_id  is not null
      and t.guardia_id is not null
      and t.fecha between p_desde and p_hasta
      and (p_objetivo_id is null or t.objetivo_id = p_objetivo_id)
      -- Alcance completo: nunca objetivos de prueba. Objetivo explicito: tal cual.
      and (p_objetivo_id is not null or o.es_prueba = false)
      -- ── La jornada con ausencia no exige rondas ───────────────────────────
      -- La falta primaria es la ausencia, y ya se cuenta en Asistencia. Cobrar
      -- ademas las rondas de un turno que la persona no trabajo es castigar dos
      -- veces el mismo hecho.
      and not exists (
        select 1
          from public.registros_asistencia ra
         where ra.turno_id = t.id
           and ra.tipo_registro = 'ausencia'
      )
  loop
    v_t_ini := r_turno.fecha + r_turno.hora_inicio;
    v_t_fin := r_turno.fecha + r_turno.hora_fin
             + case when r_turno.hora_fin <= r_turno.hora_inicio
                    then interval '1 day' else interval '0' end;

    for r_ronda in
      select rb.id, rb.hora_inicio, rb.intervalo_minutos, rb.created_at
      from public.rondas_base rb
      where rb.puesto_id = r_turno.puesto_id
        and rb.activo
        -- Una ronda sin puntos no se puede cumplir. Aunque quedara activa por
        -- error, aca no genera obligacion: es la ultima barrera y esta en la
        -- autoridad, no en una pantalla que alguien puede saltear.
        and exists (
          select 1 from public.ronda_puntos rp
           where rp.ronda_base_id = rb.id and rp.activo
        )
    loop
      v_interv := r_ronda.intervalo_minutos * interval '1 minute';

      if r_ronda.hora_inicio is null then
        v_base := v_t_ini;
      else
        v_base := r_turno.fecha + r_ronda.hora_inicio;
        -- Reposiciona la hora de inicio dentro de la ventana del turno (nocturno).
        while v_base < v_t_ini loop
          v_base := v_base + interval '1 day';
        end loop;
      end if;

      v_n := 0;
      loop
        v_vi := v_base + (v_n * v_interv);
        exit when v_vi >= v_t_fin;              -- fin de las obligaciones del turno

        -- ── Nada anterior a la creacion de la ronda ────────────────────────
        -- No es un filtro de presentacion: es que esa obligacion NO EXISTIO.
        -- Nadie pudo haberla cumplido, asi que no puede contar como incumplida
        -- ni generar una alerta.
        if (v_vi at time zone v_tz) < r_ronda.created_at then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        -- ── Horario en que la ronda no se exige ────────────────────────────
        -- Operaciones puede declarar que una ronda no se exige un día y en un
        -- horario (p. ej. Laromet: domingo desde las 06, el vigilador hace de
        -- portero). La ventana cuyo INICIO cae en ese horario no existe como
        -- obligación: no genera alerta ni cuenta en la evaluación. Mismo
        -- criterio que las pausas (inicio de la ventana).
        if exists (
          select 1 from public.ronda_horarios_sin_exigencia h
           where h.ronda_base_id = r_ronda.id
             and h.activo
             and h.dia_semana = extract(isodow from v_vi)::int
             and v_vi::time >= h.desde
             and v_vi::time <  h.hasta
        ) then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        v_vf := least(v_vi + v_interv, v_t_fin); -- deadline (acotado al turno)
        v_mf := v_vi + v_interv;                 -- limite de matching (sin acotar)

        turno_id       := r_turno.id;
        objetivo_id    := r_turno.objetivo_id;
        puesto_id      := r_turno.puesto_id;
        guardia_id     := r_turno.guardia_id;
        ronda_base_id  := r_ronda.id;
        indice         := v_n;
        ventana_inicio := v_vi           at time zone v_tz;
        ventana_fin    := v_vf           at time zone v_tz;
        match_fin      := v_mf           at time zone v_tz;
        vencimiento_at := (v_vf + v_tol) at time zone v_tz;
        return next;

        v_n := v_n + 1;
        exit when v_n > 10000;                  -- backstop defensivo
      end loop;
    end loop;
  end loop;

  return;
end;
$fn$;
-- Como hasta ahora: sólo la usan otras funciones SECURITY DEFINER y el servidor.
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from anon;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from authenticated;

notify pgrst, 'reload schema';

commit;
