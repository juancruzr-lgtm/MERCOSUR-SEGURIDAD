-- ============================================================================
-- SIN APLICAR — Rondas: historial de exigencias (foto de cada ventana al vencer)
-- ============================================================================
-- Requiere autorización expresa (AGENTS.md). Diseño, despliegue, verificación
-- y vuelta atrás: docs/auditoria-2026-10/rondas_historial_exigencias.md
--
-- ── Problema (producción, sólo lectura, 02/11/2026) ─────────────────────────
-- rondas_ventanas_programadas() recalcula las ventanas con la configuración
-- ACTUAL (intervalo y hora de inicio de la ronda, puntos activos, ronda activa,
-- turno y guardia actuales, horarios sin exigencia). El historial cambia solo:
--   · LAROMET ROSARIO 2 («Punto sur») generó 63 alertas cada 30' del 10 al
--     12/10; hoy la ronda está cada 120' (versión 9, editada el 19/10). Al
--     recalcular, esos tres turnos tienen 22 ventanas y sólo 16 coinciden con
--     una alerta: Cumplimiento y Mi Desempeño de Benítez, Fleytas, Servín y
--     Ramos (octubre, «calculada») miden contra una obligación que no existió.
--   · Un horario sin exigencia (Laromet Baigorria, cargado el 19/10) borra
--     también los domingos anteriores; darlo de baja los traería de vuelta.
--   · 20260826210000 recreó la función a partir de una copia vieja y perdió dos
--     filtros: objetivo no activo (20260810260000) y turno anulado / reemplazado
--     / cancelado (20260810200000). La definición viva NO los tiene (verificado
--     con pg_get_functiondef). Efecto visto: ANTENA, inactivo de 00:29 a 18:53
--     del 10/10, tiene una alerta pendiente de las 02:30; un turno anulado del
--     29/08 generó otra.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- 0) Reconciliación de ronda_horarios_sin_exigencia: existe en producción pero
--    20261104120000 no figura en el historial de migraciones. CREATE TABLE IF
--    NOT EXISTS con el esquema real (columnas, constraints, índice, RLS,
--    políticas, triggers y grants leídos el 02/11/2026). En producción no
--    cambia nada.
-- 1) ronda_ventanas_exigidas: foto INMUTABLE de cada ventana cuando vence
--    (ronda, turno, guardia, objetivo, puesto, ventana, vencimiento, intervalo,
--    configuración y su hash, estado de exigencia y motivo). Clave única
--    (ronda_base_id, turno_id, ventana_inicio). Estados:
--      exigible · pausada · sin_exigencia · objetivo_no_exigible · turno_sin_servicio
-- 2) rondas_ventanas_candidatas(): todas las ventanas que la configuración
--    actual produce, cada una con su estado de exigencia (no descarta: rotula).
--    Restituye los filtros perdidos el 26/08:
--      · turno anulado / reemplazado / cancelado (o con ausencia) → turno_sin_servicio
--      · objetivo no exigible EN ESE INSTANTE → objetivo_no_exigible. Si existe
--        objetivo_exigible_en (20261113120000: estado auditado, fechas de
--        servicio, suspensiones) se usa ésa; si no, el estado actual del
--        objetivo (= filtro de 20260810260000). Los objetivos de prueba
--        consultados de a uno siguen mostrando sus ventanas, como antes.
-- 3) rondas_ventanas_programadas(): misma firma y columnas; ahora es
--    candidatas filtrada a exigible + pausada (las pausas siempre estuvieron
--    incluidas: el evaluador y Cumplimiento las tratan aparte). Así
--    obtener_rondas_guardia_actual y los demás lectores recuperan los filtros.
-- 4) capturar_ventanas_exigidas(desde, hasta): guarda las ventanas ya vencidas
--    que todavía no tienen foto. ON CONFLICT DO NOTHING: una foto existente no
--    se modifica nunca (cambiar la configuración, cargar un horario, anular un
--    turno o pausar no reescribe el pasado).
-- 5) evaluar_ronda_alertas (base: 20261115120000, idéntica salvo [H]):
--    primero captura, después decide alertas SOBRE LA FOTO (sólo 'exigible').
-- 6) rondas_ventanas_historicas(): lo que leen los informes. Para cada
--    ronda+turno: las ventanas con foto ('capturada'); las que vencen después
--    de la última captura salen del cálculo actual ('programada' si todavía no
--    vencieron, 'recalculada' si vencieron y el cron no las tomó); un par sin
--    ninguna foto (historial anterior al despliegue) sale entero del cálculo
--    actual, rotulado 'recalculada'.
-- 7) cumplimiento_rondas_por_empleado / _servicio (base: 20261120150000) y
--    listar_rondas_programadas_objetivo (base: 20261120120000) leen de
--    rondas_ventanas_historicas. Cumplimiento: mismas columnas; además cuenta
--    como incumplidas las ventanas agrupadas en un episodio (20261115120000
--    las dejaba sin alerta propia y Cumplimiento las tomaba como CUMPLIDAS),
--    con el criterio de saneamiento de la alerta del episodio. Listado: suma
--    origen_ventana, estado_exigencia e intervalo_minutos.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
-- · No crea fotos del pasado: el historial anterior al despliegue queda
--   'recalculada' (con la configuración de hoy). La primera corrida del cron
--   fotografía los 2 días del lookback con la configuración vigente.
-- · No toca alertas, intervenciones, turnos ni evaluaciones publicadas.
-- · No cambia el criterio de los horarios sin exigencia en el recálculo (siguen
--   valiendo hacia atrás para lo que no tiene foto; ver pregunta abierta 2).
--
-- Orden: después de 20261115120000, 20261120120000 y 20261120150000 (se apoya
-- en sus definiciones). 20261113120000 es opcional (se detecta en ejecución).
-- Rollback: supabase/rollback/20261122120000_rondas_historial_exigencias_rollback.sql
-- Pruebas:  supabase/pruebas/rondas-historial/run.mjs (PGlite)
-- ============================================================================

begin;

-- ============================================================================
-- 0. RECONCILIACIÓN: ronda_horarios_sin_exigencia tal como está en producción
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

alter table public.ronda_horarios_sin_exigencia enable row level security;
revoke all on table public.ronda_horarios_sin_exigencia from anon, authenticated;
grant select on table public.ronda_horarios_sin_exigencia to authenticated;

-- Triggers y políticas: sólo si faltan (en producción ya están; recrearlos
-- dejaría un instante sin protección).
do $rec$
begin
  if to_regprocedure('public.ronda_horario_proteger()') is null then
    execute $f$
      create function public.ronda_horario_proteger()
      returns trigger language plpgsql set search_path = public, pg_catalog as $b$
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
      $b$ $f$;
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.ronda_horarios_sin_exigencia'::regclass
                  and tgname = 'trg_ronda_horario_proteger') then
    create trigger trg_ronda_horario_proteger
      before update or delete on public.ronda_horarios_sin_exigencia
      for each row execute function public.ronda_horario_proteger();
  end if;

  if to_regprocedure('public.protocolo_registro_inmutable()') is not null
     and not exists (select 1 from pg_trigger where tgrelid = 'public.ronda_horarios_sin_exigencia'::regclass
                      and tgname = 'trg_ronda_horarios_sin_truncate') then
    create trigger trg_ronda_horarios_sin_truncate
      before truncate on public.ronda_horarios_sin_exigencia
      for each statement execute function public.protocolo_registro_inmutable();
  end if;

  if to_regprocedure('public.puede_administrar_rondas_objetivo(uuid)') is not null
     and not exists (select 1 from pg_policy where polrelid = 'public.ronda_horarios_sin_exigencia'::regclass
                      and polname = 'Rondas: horarios sin exigencia para quien administra la ronda') then
    create policy "Rondas: horarios sin exigencia para quien administra la ronda"
      on public.ronda_horarios_sin_exigencia for select to authenticated
      using (exists (
        select 1 from public.rondas_base rb
        where rb.id = ronda_base_id and public.puede_administrar_rondas_objetivo(rb.objetivo_id)
      ));
  end if;

  if to_regprocedure('public.acceso_habilitado_actual()') is not null
     and not exists (select 1 from pg_policy where polrelid = 'public.ronda_horarios_sin_exigencia'::regclass
                      and polname = 'acceso_bloqueado_baja') then
    create policy acceso_bloqueado_baja on public.ronda_horarios_sin_exigencia
      as restrictive for all to authenticated
      using ((select public.acceso_habilitado_actual()))
      with check ((select public.acceso_habilitado_actual()));
  end if;
end;
$rec$;

-- ============================================================================
-- 1. FOTO DE CADA VENTANA EXIGIDA
-- ============================================================================
-- Sin claves foráneas a turnos / rondas / usuarios a propósito: es un registro
-- histórico y no debe impedir ni depender de cambios en esas tablas.
create table if not exists public.ronda_ventanas_exigidas (
  id                uuid primary key default gen_random_uuid(),
  ronda_base_id     uuid not null,
  turno_id          uuid not null,
  guardia_id        uuid not null,
  objetivo_id       uuid not null,
  puesto_id         uuid not null,
  turno_fecha       date not null,
  indice            integer not null,
  ventana_inicio    timestamptz not null,
  ventana_fin       timestamptz not null,
  match_fin         timestamptz not null,
  vencimiento       timestamptz not null,
  intervalo_minutos integer not null,
  config            jsonb not null,
  config_hash       text not null,
  estado_exigencia  text not null,
  motivo            text,
  pausa_id          uuid,
  captured_at       timestamptz not null default now(),
  constraint ronda_ventanas_exigidas_key unique (ronda_base_id, turno_id, ventana_inicio),
  constraint ronda_ventanas_exigidas_estado_check check (estado_exigencia in
    ('exigible', 'pausada', 'sin_exigencia', 'objetivo_no_exigible', 'turno_sin_servicio')),
  constraint ronda_ventanas_exigidas_ventana_check check (ventana_fin > ventana_inicio and vencimiento >= ventana_fin),
  constraint ronda_ventanas_exigidas_motivo_check check (estado_exigencia = 'exigible' or motivo is not null)
);

comment on table public.ronda_ventanas_exigidas is
  'Foto inmutable de cada ventana de ronda al vencer: qué se exigía, con qué configuración y por qué '
  '(o por qué no). Fuente del historial; el recálculo con la configuración actual sólo cubre lo que no '
  'tiene foto (historial anterior a 20261122120000). Ver docs/auditoria-2026-10/rondas_historial_exigencias.md';

create index if not exists ronda_ventanas_exigidas_fecha_idx
  on public.ronda_ventanas_exigidas (turno_fecha, objetivo_id);
create index if not exists ronda_ventanas_exigidas_turno_idx
  on public.ronda_ventanas_exigidas (turno_id);

-- Inmutable: ni UPDATE ni DELETE ni TRUNCATE (también para service_role).
create or replace function public.ronda_ventanas_exigidas_inmutable()
returns trigger language plpgsql set search_path = public, pg_catalog as $fn$
begin
  raise exception 'ronda_ventanas_exigidas es historial inmutable (% rechazado)', tg_op
    using errcode = '42501';
end;
$fn$;

drop trigger if exists trg_ronda_ventanas_exigidas_inmutable on public.ronda_ventanas_exigidas;
create trigger trg_ronda_ventanas_exigidas_inmutable
  before update or delete on public.ronda_ventanas_exigidas
  for each row execute function public.ronda_ventanas_exigidas_inmutable();
drop trigger if exists trg_ronda_ventanas_exigidas_sin_truncate on public.ronda_ventanas_exigidas;
create trigger trg_ronda_ventanas_exigidas_sin_truncate
  before truncate on public.ronda_ventanas_exigidas
  for each statement execute function public.ronda_ventanas_exigidas_inmutable();

-- Sólo la escriben y leen funciones SECURITY DEFINER.
alter table public.ronda_ventanas_exigidas enable row level security;
revoke all on table public.ronda_ventanas_exigidas from public, anon, authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on table public.ronda_ventanas_exigidas to service_role;
  end if;
end $g$;

-- ============================================================================
-- 2. CANDIDATAS: todas las ventanas de la configuración actual, rotuladas
-- ============================================================================
-- Mismo recorrido que rondas_ventanas_programadas (20261104120000, idéntica a
-- producción: md5 del cuerpo 986d64cd17478cd32876951a3eb8520e). Diferencias:
--   [H1] el turno anulado / reemplazado / cancelado o con ausencia no se
--        descarta: sus ventanas salen como turno_sin_servicio;
--   [H2] objetivo no exigible en el instante de la ventana → objetivo_no_exigible;
--   [H3] horario sin exigencia → sin_exigencia (antes: se descartaba);
--   [H4] pausa que cubre la ventana (mismo criterio que el evaluador) → pausada;
--   [H5] columnas de la foto: fecha del turno, intervalo, configuración y hash.
-- Lo que sigue descartando como antes (esas ventanas NO existieron): turnos sin
-- puesto o sin guardia, rondas inactivas o sin puntos activos, ventanas
-- anteriores a la creación de la ronda y, en alcance completo, objetivos de prueba.
create or replace function public.rondas_ventanas_candidatas(
  p_objetivo_id uuid,            -- NULL = todos los objetivos (excluye es_prueba)
  p_desde       date,
  p_hasta       date
)
returns table (
  turno_id          uuid,
  objetivo_id       uuid,
  puesto_id         uuid,
  guardia_id        uuid,
  ronda_base_id     uuid,
  indice            integer,
  ventana_inicio    timestamptz,
  ventana_fin       timestamptz,
  match_fin         timestamptz,
  vencimiento_at    timestamptz,
  turno_fecha       date,
  intervalo_minutos integer,
  estado_exigencia  text,
  motivo            text,
  pausa_id          uuid,
  config            jsonb,
  config_hash       text
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
  -- [H2] 20261113120000 aplicada → exigibilidad histórica; si no, estado actual.
  v_exigible_fn constant boolean :=
    to_regprocedure('public.objetivo_exigible_en(uuid,timestamp with time zone)') is not null;

  r_turno   record;
  r_ronda   record;
  v_t_ini   timestamp;
  v_t_fin   timestamp;
  v_interv  interval;
  v_base    timestamp;
  v_vi      timestamp;
  v_vf      timestamp;
  v_mf      timestamp;
  v_n       int;
  v_turno_estado text;
  v_turno_motivo text;
  v_obj_ok  boolean;
  v_pausa   uuid;
  v_config  jsonb;
begin
  v_tol := make_interval(mins => v_tol_min);

  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    return;
  end if;

  for r_turno in
    select t.id, t.fecha, t.hora_inicio, t.hora_fin, t.estado,
           t.objetivo_id, t.puesto_id, t.guardia_id,
           o.estado as objetivo_estado, coalesce(o.es_prueba, false) as es_prueba,
           exists (select 1 from public.registros_asistencia ra
                    where ra.turno_id = t.id and ra.tipo_registro = 'ausencia') as con_ausencia
    from public.turnos t
    join public.objetivos o on o.id = t.objetivo_id
    where t.puesto_id  is not null
      and t.guardia_id is not null
      and t.fecha between p_desde and p_hasta
      and (p_objetivo_id is null or t.objetivo_id = p_objetivo_id)
      -- Alcance completo: nunca objetivos de prueba. Objetivo explicito: tal cual.
      and (p_objetivo_id is not null or o.es_prueba = false)
  loop
    -- [H1] Turno sin servicio: no exige, pero queda constancia.
    v_turno_estado := null;
    v_turno_motivo := null;
    if coalesce(r_turno.estado, '') in ('reemplazado', 'anulado', 'cancelado') then
      v_turno_estado := 'turno_sin_servicio';
      v_turno_motivo := 'turno ' || r_turno.estado;
    elsif r_turno.con_ausencia then
      -- La falta primaria es la ausencia, y ya se cuenta en Asistencia.
      v_turno_estado := 'turno_sin_servicio';
      v_turno_motivo := 'ausencia registrada';
    end if;

    v_t_ini := r_turno.fecha + r_turno.hora_inicio;
    v_t_fin := r_turno.fecha + r_turno.hora_fin
             + case when r_turno.hora_fin <= r_turno.hora_inicio
                    then interval '1 day' else interval '0' end;

    for r_ronda in
      select rb.id, rb.hora_inicio, rb.intervalo_minutos, rb.created_at, rb.version, rb.updated_at,
             (select count(*) from public.ronda_puntos rp
               where rp.ronda_base_id = rb.id and rp.activo) as puntos_activos
      from public.rondas_base rb
      where rb.puesto_id = r_turno.puesto_id
        and rb.activo
        and exists (
          select 1 from public.ronda_puntos rp
           where rp.ronda_base_id = rb.id and rp.activo
        )
    loop
      v_interv := r_ronda.intervalo_minutos * interval '1 minute';

      -- [H5] Configuración con la que se calculó la ventana.
      v_config := jsonb_build_object(
        'intervalo_minutos', r_ronda.intervalo_minutos,
        'hora_inicio_ronda', r_ronda.hora_inicio,
        'ronda_version',     r_ronda.version,
        'ronda_updated_at',  r_ronda.updated_at,
        'puntos_activos',    r_ronda.puntos_activos,
        'turno_hora_inicio', r_turno.hora_inicio,
        'turno_hora_fin',    r_turno.hora_fin,
        'turno_estado',      r_turno.estado,
        'guardia_id',        r_turno.guardia_id,
        'puesto_id',         r_turno.puesto_id,
        'tolerancia_min',    v_tol_min);

      if r_ronda.hora_inicio is null then
        v_base := v_t_ini;
      else
        v_base := r_turno.fecha + r_ronda.hora_inicio;
        while v_base < v_t_ini loop
          v_base := v_base + interval '1 day';
        end loop;
      end if;

      v_n := 0;
      loop
        v_vi := v_base + (v_n * v_interv);
        exit when v_vi >= v_t_fin;

        -- Nada anterior a la creacion de la ronda: esa obligacion NO EXISTIO.
        if (v_vi at time zone v_tz) < r_ronda.created_at then
          v_n := v_n + 1;
          exit when v_n > 10000;
          continue;
        end if;

        v_vf := least(v_vi + v_interv, v_t_fin);
        v_mf := v_vi + v_interv;

        estado_exigencia := 'exigible';
        motivo           := null;
        pausa_id         := null;

        if v_turno_estado is not null then
          estado_exigencia := v_turno_estado;
          motivo           := v_turno_motivo;
        else
          -- [H2] Objetivo exigible en el instante de la ventana.
          if v_exigible_fn and not r_turno.es_prueba then
            v_obj_ok := public.objetivo_exigible_en(r_turno.objetivo_id, v_vi at time zone v_tz);
          else
            v_obj_ok := (r_turno.objetivo_estado = 'activo');
          end if;

          if not coalesce(v_obj_ok, false) then
            estado_exigencia := 'objetivo_no_exigible';
            motivo           := case when v_exigible_fn
                                     then 'objetivo sin servicio, suspendido o no activo en ese momento'
                                     else 'objetivo ' || coalesce(r_turno.objetivo_estado, 'sin estado') end;
          -- [H3] Horario en que la ronda no se exige (criterio de 20261104120000).
          elsif exists (
            select 1 from public.ronda_horarios_sin_exigencia h
             where h.ronda_base_id = r_ronda.id
               and h.activo
               and h.dia_semana = extract(isodow from v_vi)::int
               and v_vi::time >= h.desde
               and v_vi::time <  h.hasta
          ) then
            estado_exigencia := 'sin_exigencia';
            motivo           := (select h.motivo from public.ronda_horarios_sin_exigencia h
                                  where h.ronda_base_id = r_ronda.id and h.activo
                                    and h.dia_semana = extract(isodow from v_vi)::int
                                    and v_vi::time >= h.desde and v_vi::time < h.hasta
                                  order by h.creado_at limit 1);
          else
            -- [H4] Pausa que cubre el inicio de la ventana (criterio del evaluador).
            v_pausa := (
              select p.id from public.ronda_pausas p
               where p.ronda_base_id = r_ronda.id
                 and p.pausada_at <= (v_vi at time zone v_tz)
                 and (
                   (p.activa = true and p.hasta_at is null)
                   or (p.activa = true and p.hasta_at is not null and (v_vi at time zone v_tz) < p.hasta_at)
                   or (p.activa = false and p.reactivada_at is not null and (v_vi at time zone v_tz) < p.reactivada_at)
                 )
               order by p.pausada_at desc
               limit 1);
            if v_pausa is not null then
              estado_exigencia := 'pausada';
              motivo           := 'ronda pausada';
              pausa_id         := v_pausa;
            end if;
          end if;
        end if;

        turno_id          := r_turno.id;
        objetivo_id       := r_turno.objetivo_id;
        puesto_id         := r_turno.puesto_id;
        guardia_id        := r_turno.guardia_id;
        ronda_base_id     := r_ronda.id;
        indice            := v_n;
        ventana_inicio    := v_vi           at time zone v_tz;
        ventana_fin       := v_vf           at time zone v_tz;
        match_fin         := v_mf           at time zone v_tz;
        vencimiento_at    := (v_vf + v_tol) at time zone v_tz;
        turno_fecha       := r_turno.fecha;
        intervalo_minutos := r_ronda.intervalo_minutos;
        config            := v_config;
        config_hash       := md5(v_config::text);
        return next;

        v_n := v_n + 1;
        exit when v_n > 10000;
      end loop;
    end loop;
  end loop;

  return;
end;
$fn$;

-- ============================================================================
-- 3. rondas_ventanas_programadas: misma firma, filtros restituidos
-- ============================================================================
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
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  -- Exigibles y pausadas (la pausa la siguen tratando aparte el evaluador y
  -- Cumplimiento). Fuera: turno sin servicio, objetivo no exigible, horario
  -- sin exigencia.
  select c.turno_id, c.objetivo_id, c.puesto_id, c.guardia_id, c.ronda_base_id, c.indice,
         c.ventana_inicio, c.ventana_fin, c.match_fin, c.vencimiento_at
    from public.rondas_ventanas_candidatas(p_objetivo_id, p_desde, p_hasta) c
   where c.estado_exigencia in ('exigible', 'pausada')
$fn$;

comment on function public.rondas_ventanas_programadas(uuid, date, date) is
  'Ventanas de ronda exigibles (o pausadas) con la configuración ACTUAL. Excluye turnos '
  'anulados/reemplazados/cancelados o con ausencia, objetivos no exigibles, horarios sin '
  'exigencia y, en alcance completo, objetivos de prueba. Para historial: rondas_ventanas_historicas.';

-- ============================================================================
-- 4. CAPTURA (idempotente; nunca reescribe una foto)
-- ============================================================================
create or replace function public.capturar_ventanas_exigidas(p_desde date, p_hasta date)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_filas integer;
begin
  insert into public.ronda_ventanas_exigidas (
    ronda_base_id, turno_id, guardia_id, objetivo_id, puesto_id, turno_fecha, indice,
    ventana_inicio, ventana_fin, match_fin, vencimiento, intervalo_minutos,
    config, config_hash, estado_exigencia, motivo, pausa_id
  )
  select c.ronda_base_id, c.turno_id, c.guardia_id, c.objetivo_id, c.puesto_id, c.turno_fecha, c.indice,
         c.ventana_inicio, c.ventana_fin, c.match_fin, c.vencimiento_at, c.intervalo_minutos,
         c.config, c.config_hash, c.estado_exigencia, c.motivo, c.pausa_id
    from public.rondas_ventanas_candidatas(null, p_desde, p_hasta) c
   where c.vencimiento_at <= now()
   order by c.ronda_base_id, c.turno_id, c.ventana_inicio
  on conflict (ronda_base_id, turno_id, ventana_inicio) do nothing;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$fn$;

-- ============================================================================
-- 5. evaluar_ronda_alertas: decide sobre la foto
-- ============================================================================
-- Idéntica a 20261115120000 salvo [H]:
--   · captura las ventanas vencidas del lookback ANTES de decidir;
--   · recorre las fotos 'exigible' del lookback (antes: el recálculo con la
--     configuración actual). Una foto 'pausada', 'sin_exigencia',
--     'objetivo_no_exigible' o 'turno_sin_servicio' no genera alerta.
create or replace function public.evaluar_ronda_alertas()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_tz            constant text := 'America/Argentina/Buenos_Aires';
  v_ahora         timestamptz := now();
  v_hoy           date := (now() at time zone v_tz)::date;
  v_lookback_dias int := coalesce((
    select nullif(value, '')::int from public.app_config
     where key = 'ronda_alerta_lookback_dias'), 2);

  r           record;
  v_ejec      record;
  v_tipo      text;
  v_ejec_id   uuid;
  v_afectadas int := 0;
  v_existente uuid;
  v_episodio  uuid;
  v_filas     int;
begin
  -- Auto-reactivación de pausas con hasta_at vencido. Idempotente.
  update public.ronda_pausas
  set activa                  = false,
      reactivada_at           = coalesce(reactivada_at, hasta_at, now()),
      reactivada_por          = null,
      reactivada_comentario   = coalesce(
        reactivada_comentario,
        'Reactivación automática por vencimiento de la pausa'
      ),
      reactivacion_automatica = true,
      updated_at              = now()
  where activa = true
    and hasta_at is not null
    and hasta_at <= now();

  -- [H] Foto de las ventanas vencidas del lookback que todavía no la tienen.
  perform public.capturar_ventanas_exigidas(v_hoy - v_lookback_dias, v_hoy);

  for r in
    -- [H] Se decide sobre la foto, no sobre el recálculo.
    select s.ronda_base_id, s.turno_id, s.objetivo_id, s.puesto_id, s.guardia_id,
           s.ventana_inicio, s.ventana_fin, s.match_fin, s.vencimiento as vencimiento_at
      from public.ronda_ventanas_exigidas s
     where s.turno_fecha between v_hoy - v_lookback_dias and v_hoy
       and s.estado_exigencia = 'exigible'
     order by s.ronda_base_id, s.turno_id, s.ventana_inicio
  loop
    if v_ahora < r.vencimiento_at then
      continue;
    end if;

    -- ¿Existe una pausa que cubra esta ventana?
    if exists (
      select 1
      from public.ronda_pausas p
      where p.ronda_base_id = r.ronda_base_id
        and p.pausada_at <= r.ventana_inicio
        and (
          (p.activa = true and p.hasta_at is null)
          or (p.activa = true and p.hasta_at is not null and r.ventana_inicio < p.hasta_at)
          or (p.activa = false and p.reactivada_at is not null and r.ventana_inicio < p.reactivada_at)
        )
    ) then
      continue;
    end if;

    select e.id, e.iniciada_at, e.finalizada_at, e.estado
      into v_ejec
      from public.ronda_ejecuciones e
     where e.ronda_base_id = r.ronda_base_id
       and e.turno_id      = r.turno_id
       and e.estado in ('en_curso', 'finalizada')
       and e.iniciada_at >= r.ventana_inicio
       and e.iniciada_at <  r.match_fin
     order by e.iniciada_at asc
     limit 1;

    if not found then
      v_tipo    := 'no_iniciada';
      v_ejec_id := null;
    elsif v_ejec.iniciada_at < r.vencimiento_at then
      if v_ejec.estado = 'en_curso'
         or (v_ejec.finalizada_at is not null and v_ejec.finalizada_at > r.vencimiento_at) then
        v_tipo    := 'no_finalizada';
        v_ejec_id := v_ejec.id;
      else
        v_tipo    := null;
      end if;
    else
      v_tipo    := 'no_iniciada';
      v_ejec_id := v_ejec.id;
    end if;

    -- C2 · Suspensión declarada por el vigilador para esta ronda y turno.
    if v_tipo = 'no_iniciada' and exists (
      select 1
        from public.ronda_alertas a
       where a.ronda_base_id = r.ronda_base_id
         and a.turno_id      = r.turno_id
         and a.tipo          = 'suspendida'
         and a.estado        = 'pendiente'
    ) then
      v_tipo := null;
    end if;

    if v_tipo is null then
      continue;
    end if;

    -- ¿La ventana ya tiene su propia alerta? Se mantiene el upsert de siempre
    -- (historial y alertas anteriores al cambio).
    select a.id into v_existente
      from public.ronda_alertas a
     where a.ronda_base_id  = r.ronda_base_id
       and a.turno_id       = r.turno_id
       and a.ventana_inicio = r.ventana_inicio
       and a.tipo           = v_tipo;

    if v_existente is null then
      -- ¿La ventana ya quedó agrupada en un episodio? Sólo se completa la
      -- ejecución, como hacía el upsert.
      update public.ronda_alerta_ventanas_episodio w
         set ejecucion_id = coalesce(v_ejec_id, w.ejecucion_id)
       where w.ronda_base_id  = r.ronda_base_id
         and w.turno_id       = r.turno_id
         and w.ventana_inicio = r.ventana_inicio
         and w.tipo           = v_tipo;
      if found then
        continue;
      end if;

      -- ¿Hay un episodio de esta ronda y turno que cubra la ventana? (ver
      -- 20261115120000).
      select a.id into v_episodio
        from public.ronda_alertas a
       where a.ronda_base_id  = r.ronda_base_id
         and a.turno_id       = r.turno_id
         and a.tipo in ('no_iniciada', 'no_finalizada')
         and a.ventana_inicio < r.ventana_inicio
         and (
           a.estado = 'pendiente'
           or a.resultado_intervencion = 'no_resuelto'
           or (a.resultado_intervencion = 'resuelto'
               and coalesce(a.motivo_intervencion, '') <> 'ronda_realizada')
         )
       order by a.ventana_inicio asc
       limit 1;

      if v_episodio is not null then
        insert into public.ronda_alerta_ventanas_episodio (
          ronda_alerta_id, ronda_base_id, turno_id, tipo,
          ventana_inicio, ventana_fin, vencimiento_at, ejecucion_id
        ) values (
          v_episodio, r.ronda_base_id, r.turno_id, v_tipo,
          r.ventana_inicio, r.ventana_fin, r.vencimiento_at, v_ejec_id
        )
        on conflict (ronda_base_id, turno_id, ventana_inicio, tipo) do nothing;
        get diagnostics v_filas = row_count;
        if v_filas > 0 then
          update public.ronda_alertas
             set ventanas_adicionales  = ventanas_adicionales + 1,
                 ultima_ventana_inicio = greatest(coalesce(ultima_ventana_inicio, r.ventana_inicio), r.ventana_inicio)
           where id = v_episodio;
          v_afectadas := v_afectadas + 1;
        end if;
        continue;
      end if;
    end if;

    insert into public.ronda_alertas (
      objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
      tipo, ventana_inicio, ventana_fin, vencimiento_at
    ) values (
      r.objetivo_id, r.puesto_id, r.ronda_base_id, r.turno_id, r.guardia_id, v_ejec_id,
      v_tipo, r.ventana_inicio, r.ventana_fin, r.vencimiento_at
    )
    on conflict (ronda_base_id, turno_id, ventana_inicio, tipo) do update
      set ejecucion_id = coalesce(excluded.ejecucion_id, ronda_alertas.ejecucion_id),
          updated_at   = now()
      where ronda_alertas.estado = 'pendiente';

    v_afectadas := v_afectadas + 1;
  end loop;

  -- Cierre automático por inicio tarde (sin cambios respecto de 20261115120000).
  with cand as (
    select a.id,
           (select min(e.iniciada_at)
              from public.ronda_ejecuciones e
             where e.ronda_base_id = a.ronda_base_id
               and e.turno_id      = a.turno_id
               and e.estado in ('en_curso', 'finalizada')
               and e.iniciada_at  >= a.ventana_inicio) as iniciada
      from public.ronda_alertas a
     where a.estado = 'pendiente'
       and a.tipo   = 'no_iniciada'
       and a.ventanas_adicionales = 0
       and a.ventana_inicio >= ((v_hoy - v_lookback_dias)::timestamp at time zone v_tz)
  ), cerradas as (
    update public.ronda_alertas a
       set estado                 = 'resuelta',
           resuelta_por           = null,
           resuelta_at            = now(),
           accion                 = 'resuelta',
           comentario             = 'Cierre automático: la ronda se inició a las '
                                    || to_char(c.iniciada at time zone v_tz, 'HH24:MI')
                                    || ' dentro del turno.',
           resultado_intervencion = 'resuelto',
           motivo_intervencion    = 'ronda_realizada',
           seguimiento_hasta      = null,
           updated_at             = now()
      from cand c
     where a.id = c.id
       and c.iniciada is not null
       and a.estado = 'pendiente'
    returning a.id, c.iniciada
  )
  insert into public.ronda_alerta_intervenciones
    (ronda_alerta_id, supervisor_id, origen, accion, comentario,
     estado_anterior, estado_nuevo, resultado, motivo)
  select x.id, null, 'sistema', 'resuelta',
         'Cierre automático: la ronda se inició a las '
           || to_char(x.iniciada at time zone v_tz, 'HH24:MI') || ' dentro del turno.',
         'pendiente', 'resuelta', 'resuelto', 'ronda_realizada'
    from cerradas x;

  return v_afectadas;
end;
$fn$;

-- ============================================================================
-- 6. HISTORIAL: foto primero, recálculo sólo donde no hay foto
-- ============================================================================
create or replace function public.rondas_ventanas_historicas(
  p_objetivo_id uuid,
  p_desde       date,
  p_hasta       date
)
returns table (
  turno_id          uuid,
  objetivo_id       uuid,
  puesto_id         uuid,
  guardia_id        uuid,
  ronda_base_id     uuid,
  indice            integer,
  ventana_inicio    timestamptz,
  ventana_fin       timestamptz,
  match_fin         timestamptz,
  vencimiento_at    timestamptz,
  turno_fecha       date,
  intervalo_minutos integer,
  estado_exigencia  text,
  motivo            text,
  origen            text          -- 'capturada' | 'recalculada' | 'programada'
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  with s as (
    select x.*
      from public.ronda_ventanas_exigidas x
     where p_desde is not null and p_hasta is not null
       and x.turno_fecha between p_desde and p_hasta
       and (p_objetivo_id is null or x.objetivo_id = p_objetivo_id)
  ), cap as (
    -- Hasta cuándo se fotografió cada ronda+turno: lo que venció antes de la
    -- última captura y no tiene foto NO existía entonces (otra configuración).
    select s.ronda_base_id, s.turno_id, max(s.captured_at) as hasta
      from s group by s.ronda_base_id, s.turno_id
  ), c as (
    select x.* from public.rondas_ventanas_candidatas(p_objetivo_id, p_desde, p_hasta) x
  )
  select s.turno_id, s.objetivo_id, s.puesto_id, s.guardia_id, s.ronda_base_id, s.indice,
         s.ventana_inicio, s.ventana_fin, s.match_fin, s.vencimiento, s.turno_fecha,
         s.intervalo_minutos, s.estado_exigencia, s.motivo, 'capturada'::text
    from s
  union all
  select c.turno_id, c.objetivo_id, c.puesto_id, c.guardia_id, c.ronda_base_id, c.indice,
         c.ventana_inicio, c.ventana_fin, c.match_fin, c.vencimiento_at, c.turno_fecha,
         c.intervalo_minutos, c.estado_exigencia, c.motivo,
         case when c.vencimiento_at > now() then 'programada' else 'recalculada' end
    from c
    left join cap on cap.ronda_base_id = c.ronda_base_id and cap.turno_id = c.turno_id
   where (cap.hasta is null or c.vencimiento_at > cap.hasta)
     and not exists (
       select 1 from s
        where s.ronda_base_id  = c.ronda_base_id
          and s.turno_id       = c.turno_id
          and s.ventana_inicio = c.ventana_inicio)
$fn$;

comment on function public.rondas_ventanas_historicas(uuid, date, date) is
  'Ventanas para informes: la foto (capturada) donde existe; el cálculo actual sólo para lo que vence '
  'después de la última foto (programada / recalculada) o para el historial sin foto (recalculada).';

-- ============================================================================
-- 7. LECTORES DEL HISTORIAL
-- ============================================================================
-- cumplimiento_rondas_por_empleado y _servicio: idénticas a 20261120150000
-- salvo [H]: fuente de ventanas (foto primero) y ventanas agrupadas en
-- episodios. Mismas firmas y columnas.
create or replace function public.cumplimiento_rondas_por_empleado(p_desde date, p_hasta date)
returns table (
  guardia_id                uuid,
  obligaciones              integer,
  cumplidas                 integer,
  no_iniciada               integer,
  no_finalizada             integer,
  suspendida                integer,
  saneadas                  integer,
  bajo_pausa                integer,
  pausa_atribuible          integer,
  pausa_no_atribuible       integer,
  pausa_capacitacion        integer,
  pausa_sin_clasificar      integer,
  motivos_pausa             jsonb,
  causas_pausa              jsonb,
  turnos_con_obligacion     integer,
  turnos_con_atribuibles    integer,
  turnos_con_incumplimiento integer,
  turnos_sin_incumplimiento integer
)
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  with v as (
    select x.*
      from public.rondas_ventanas_historicas(null, p_desde, p_hasta) x   -- [H] foto primero
     where x.estado_exigencia in ('exigible', 'pausada')                    -- [H]
       and x.vencimiento_at < now()
       and x.guardia_id is not null
       and public.puede_administrar_rondas_objetivo(x.objetivo_id)
  ), al as (
    select a.turno_id, a.ronda_base_id, a.ventana_inicio, a.tipo,
           public.ronda_alerta_no_penaliza(a) as saneada                      -- [D] criterio único
      from public.ronda_alertas a
     -- [D] Límites del período en hora argentina (antes: medianoche UTC, que
     -- dejaba afuera las alertas de 21:00 a 24:00 del último día y las
     -- contaba como rondas cumplidas).
     where a.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and a.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    -- [H] Ventanas agrupadas en un episodio (20261115120000): no tienen alerta
    -- propia y sin esto contaban como CUMPLIDAS. Cuentan como incumplidas con
    -- el criterio de la alerta del episodio (si el episodio no penaliza, por
    -- ejemplo cerrado por error técnico, sus ventanas tampoco).
    union all
    select w.turno_id, w.ronda_base_id, w.ventana_inicio, w.tipo,
           public.ronda_alerta_no_penaliza(ae) as saneada
      from public.ronda_alerta_ventanas_episodio w
      join public.ronda_alertas ae on ae.id = w.ronda_alerta_id
     where w.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and w.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and not exists (
         select 1 from public.ronda_alertas a2
          where a2.ronda_base_id = w.ronda_base_id and a2.turno_id = w.turno_id
            and a2.ventana_inicio = w.ventana_inicio)
  ), x as (
    select v.guardia_id,
           v.turno_id,
           al.tipo,
           coalesce(al.saneada, false) as saneada,
           pa.motivo as motivo_pausa,
           pa.causa  as causa_pausa,
           (pa.id is not null) as pausada
      from v
      left join al
        on al.turno_id       = v.turno_id
       and al.ronda_base_id  = v.ronda_base_id
       and al.ventana_inicio = v.ventana_inicio
      left join lateral (
        select p.id, p.motivo, p.causa
          from public.ronda_pausas p
         where p.ronda_base_id = v.ronda_base_id
           and p.pausada_at <= v.ventana_inicio
           and (p.reactivada_at is null or p.reactivada_at > v.ventana_inicio)
           and (p.hasta_at is null or p.hasta_at > v.ventana_inicio)
         order by p.pausada_at desc
         limit 1
      ) pa on true
  ), mp as (
    select x.guardia_id, x.motivo_pausa as motivo, count(*) as n
      from x where x.pausada and not x.saneada
     group by 1, 2
  ), motivos as (
    select mp.guardia_id, jsonb_object_agg(mp.motivo, mp.n) as j
      from mp group by 1
  ), cp as (
    select x.guardia_id,
           coalesce(x.causa_pausa, 'sin_clasificar') as causa,
           count(*) as n
      from x where x.pausada and not x.saneada
     group by 1, 2
  ), causas as (
    select cp.guardia_id, jsonb_object_agg(cp.causa, cp.n) as j
      from cp group by 1
  ), pt as (
    select x.guardia_id, x.turno_id,
           count(*) filter (where not x.saneada and not x.pausada) as atribuibles,
           count(*) filter (where x.tipo is not null and not x.saneada and not x.pausada) as incumplidas
      from x group by 1, 2
  ), tt as (
    select pt.guardia_id,
           count(*)::integer as turnos_con_obligacion,
           count(*) filter (where pt.atribuibles > 0)::integer as turnos_con_atribuibles,
           count(*) filter (where pt.incumplidas > 0)::integer as turnos_con_incumplimiento,
           count(*) filter (where pt.atribuibles > 0 and pt.incumplidas = 0)::integer as turnos_sin_incumplimiento
      from pt group by 1
  )
  select
    x.guardia_id,
    count(*)::integer,
    count(*) filter (where x.tipo is null and not x.pausada and not x.saneada)::integer,
    count(*) filter (where x.tipo = 'no_iniciada'   and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.tipo = 'no_finalizada' and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.tipo = 'suspendida'    and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.saneada)::integer,
    count(*) filter (where x.pausada and not x.saneada)::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa = 'no_se_realiza')::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa in ('tecnica_gps', 'configuracion', 'no_aplica'))::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa = 'capacitacion')::integer,
    count(*) filter (where x.pausada and not x.saneada and (x.causa_pausa is null or x.causa_pausa = 'otra'))::integer,
    coalesce(motivos.j, '{}'::jsonb),
    coalesce(causas.j,  '{}'::jsonb),
    coalesce(tt.turnos_con_obligacion, 0),
    coalesce(tt.turnos_con_atribuibles, 0),
    coalesce(tt.turnos_con_incumplimiento, 0),
    coalesce(tt.turnos_sin_incumplimiento, 0)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  left join causas  on causas.guardia_id  = x.guardia_id
  left join tt      on tt.guardia_id      = x.guardia_id
  group by x.guardia_id, motivos.j, causas.j,
           tt.turnos_con_obligacion, tt.turnos_con_atribuibles,
           tt.turnos_con_incumplimiento, tt.turnos_sin_incumplimiento;
$fn$;

create or replace function public.cumplimiento_rondas_por_empleado_servicio(p_desde date, p_hasta date)
returns table (
  guardia_id                uuid,
  obligaciones              integer,
  cumplidas                 integer,
  no_iniciada               integer,
  no_finalizada             integer,
  suspendida                integer,
  saneadas                  integer,
  bajo_pausa                integer,
  pausa_atribuible          integer,
  pausa_no_atribuible       integer,
  pausa_capacitacion        integer,
  pausa_sin_clasificar      integer,
  motivos_pausa             jsonb,
  causas_pausa              jsonb,
  turnos_con_obligacion     integer,
  turnos_con_atribuibles    integer,
  turnos_con_incumplimiento integer,
  turnos_sin_incumplimiento integer
)
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  with v as (
    select x.*
      from public.rondas_ventanas_historicas(null, p_desde, p_hasta) x   -- [H] foto primero
     where x.estado_exigencia in ('exigible', 'pausada')                    -- [H]
       and x.vencimiento_at < now()
       and x.guardia_id is not null
  ), al as (
    select a.turno_id, a.ronda_base_id, a.ventana_inicio, a.tipo,
           public.ronda_alerta_no_penaliza(a) as saneada                      -- [D] criterio único
      from public.ronda_alertas a
     -- [D] Límites del período en hora argentina (antes: medianoche UTC, que
     -- dejaba afuera las alertas de 21:00 a 24:00 del último día y las
     -- contaba como rondas cumplidas).
     where a.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and a.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
    -- [H] Ventanas agrupadas en un episodio (20261115120000): no tienen alerta
    -- propia y sin esto contaban como CUMPLIDAS. Cuentan como incumplidas con
    -- el criterio de la alerta del episodio (si el episodio no penaliza, por
    -- ejemplo cerrado por error técnico, sus ventanas tampoco).
    union all
    select w.turno_id, w.ronda_base_id, w.ventana_inicio, w.tipo,
           public.ronda_alerta_no_penaliza(ae) as saneada
      from public.ronda_alerta_ventanas_episodio w
      join public.ronda_alertas ae on ae.id = w.ronda_alerta_id
     where w.ventana_inicio >= (p_desde::timestamp       at time zone 'America/Argentina/Buenos_Aires')
       and w.ventana_inicio <  ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
       and not exists (
         select 1 from public.ronda_alertas a2
          where a2.ronda_base_id = w.ronda_base_id and a2.turno_id = w.turno_id
            and a2.ventana_inicio = w.ventana_inicio)
  ), x as (
    select v.guardia_id,
           v.turno_id,
           al.tipo,
           coalesce(al.saneada, false) as saneada,
           pa.motivo as motivo_pausa,
           pa.causa  as causa_pausa,
           (pa.id is not null) as pausada
      from v
      left join al
        on al.turno_id       = v.turno_id
       and al.ronda_base_id  = v.ronda_base_id
       and al.ventana_inicio = v.ventana_inicio
      left join lateral (
        select p.id, p.motivo, p.causa
          from public.ronda_pausas p
         where p.ronda_base_id = v.ronda_base_id
           and p.pausada_at <= v.ventana_inicio
           and (p.reactivada_at is null or p.reactivada_at > v.ventana_inicio)
           and (p.hasta_at is null or p.hasta_at > v.ventana_inicio)
         order by p.pausada_at desc
         limit 1
      ) pa on true
  ), mp as (
    select x.guardia_id, x.motivo_pausa as motivo, count(*) as n
      from x where x.pausada and not x.saneada
     group by 1, 2
  ), motivos as (
    select mp.guardia_id, jsonb_object_agg(mp.motivo, mp.n) as j
      from mp group by 1
  ), cp as (
    select x.guardia_id,
           coalesce(x.causa_pausa, 'sin_clasificar') as causa,
           count(*) as n
      from x where x.pausada and not x.saneada
     group by 1, 2
  ), causas as (
    select cp.guardia_id, jsonb_object_agg(cp.causa, cp.n) as j
      from cp group by 1
  ), pt as (
    select x.guardia_id, x.turno_id,
           count(*) filter (where not x.saneada and not x.pausada) as atribuibles,
           count(*) filter (where x.tipo is not null and not x.saneada and not x.pausada) as incumplidas
      from x group by 1, 2
  ), tt as (
    select pt.guardia_id,
           count(*)::integer as turnos_con_obligacion,
           count(*) filter (where pt.atribuibles > 0)::integer as turnos_con_atribuibles,
           count(*) filter (where pt.incumplidas > 0)::integer as turnos_con_incumplimiento,
           count(*) filter (where pt.atribuibles > 0 and pt.incumplidas = 0)::integer as turnos_sin_incumplimiento
      from pt group by 1
  )
  select
    x.guardia_id,
    count(*)::integer,
    count(*) filter (where x.tipo is null and not x.pausada and not x.saneada)::integer,
    count(*) filter (where x.tipo = 'no_iniciada'   and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.tipo = 'no_finalizada' and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.tipo = 'suspendida'    and not x.saneada and not x.pausada)::integer,
    count(*) filter (where x.saneada)::integer,
    count(*) filter (where x.pausada and not x.saneada)::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa = 'no_se_realiza')::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa in ('tecnica_gps', 'configuracion', 'no_aplica'))::integer,
    count(*) filter (where x.pausada and not x.saneada and x.causa_pausa = 'capacitacion')::integer,
    count(*) filter (where x.pausada and not x.saneada and (x.causa_pausa is null or x.causa_pausa = 'otra'))::integer,
    coalesce(motivos.j, '{}'::jsonb),
    coalesce(causas.j,  '{}'::jsonb),
    coalesce(tt.turnos_con_obligacion, 0),
    coalesce(tt.turnos_con_atribuibles, 0),
    coalesce(tt.turnos_con_incumplimiento, 0),
    coalesce(tt.turnos_sin_incumplimiento, 0)
  from x
  left join motivos on motivos.guardia_id = x.guardia_id
  left join causas  on causas.guardia_id  = x.guardia_id
  left join tt      on tt.guardia_id      = x.guardia_id
  group by x.guardia_id, motivos.j, causas.j,
           tt.turnos_con_obligacion, tt.turnos_con_atribuibles,
           tt.turnos_con_incumplimiento, tt.turnos_sin_incumplimiento;
$fn$;

-- listar_rondas_programadas_objetivo: idéntica a 20261120120000 salvo [H].
create or replace function public.listar_rondas_programadas_objetivo(
  p_objetivo_id uuid,
  p_desde       date,
  p_hasta       date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'rondas', jsonb_build_array());
  end if;

  if p_objetivo_id is null or p_desde is null or p_hasta is null or p_desde > p_hasta then
    return jsonb_build_object('contexto', 'rango_invalido', 'rondas', jsonb_build_array());
  end if;

  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'rondas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'rondas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'ronda_base_id',   v.ronda_base_id,
          'ronda_nombre',    rb.nombre,
          'puesto_id',       v.puesto_id,
          'puesto_nombre',   pu.nombre,
          'turno_id',        v.turno_id,
          'guardia_id',      v.guardia_id,
          'guardia_nombre',  g.apellido || ', ' || g.nombre,
          'ventana_inicio',  v.ventana_inicio,
          'ventana_fin',     v.ventana_fin,
          'vencimiento_at',  v.vencimiento_at,
          -- [H] De dónde sale la ventana: 'capturada' (foto al vencer),
          -- 'recalculada' (sin foto: configuración actual) o 'programada'.
          'origen_ventana',    v.origen,
          'estado_exigencia',  v.estado_exigencia,
          'intervalo_minutos', v.intervalo_minutos,

          'estado',
            case
              when e.id is not null and e.estado = 'en_curso'    then 'en_curso'
              when e.id is not null and e.resultado = 'completa' then 'completada'
              when e.id is not null and e.resultado = 'pendiente_validacion'
                                                                 then 'pendiente_validacion'  -- [REGLA]
              when e.id is not null                              then 'incompleta'
              -- Solo una pausa VIGENTE define el estado operativo. Una pausa ya
              -- reanudada sigue registrada en los campos pausa_* de abajo.
              when pa.id is not null and pa.vigente              then 'pausada'
              when now() < v.vencimiento_at                      then 'pendiente'
              else                                                    'no_iniciada'
            end,
          'inicio_tardio',
            (e.id is not null and e.iniciada_at >= v.vencimiento_at),

          'ejecucion_id',       e.id,
          'iniciada_at',        e.iniciada_at,
          'finalizada_at',      e.finalizada_at,
          'resultado',          e.resultado,
          'puntos_total',       e.puntos_total,
          'puntos_cumplidos',   coalesce(cnt.cumplidos,   0),
          'puntos_incumplidos', coalesce(cnt.incumplidos, 0),
          'puntos_omitidos',    coalesce(cnt.omitidos,    0),
          'puntos_pendientes_validacion', coalesce(cnt.pendientes_validacion, 0),  -- [REGLA]
          'cerrada_por',        e.cerrada_por,
          'cerrada_at',         e.cerrada_at,
          'cerrada_motivo',     e.cerrada_motivo,
          'es_cierre_administrativo', (e.cerrada_por is not null),

          'alerta_id',              al.id,
          'alerta_tipo',            al.tipo,
          'alerta_estado',          al.estado,
          'alerta_suspendida',      (al.tipo = 'suspendida'),
          'alerta_motivo_vigilador',al.motivo_vigilador,
          'alerta_accion',          al.accion,
          'alerta_comentario',      al.comentario,
          'alerta_resuelta_por_nombre',
            case when al.resuelta_por is null then null
                 else rp.apellido || ', ' || rp.nombre end,
          'alerta_resuelta_at',     al.resuelta_at,
          'alerta_intervenciones',  coalesce(iv.total, 0),

          -- Anexo de pausa. NO condiciona estados previos; solo informa.
          -- `pausada` es historial: esta ventana estuvo cubierta por una pausa.
          -- `pausa_vigente` es operativo: esa pausa sigue activa ahora.
          'pausada',              (pa.id is not null),
          'pausa_vigente',        coalesce(pa.vigente, false),
          'pausa_id',             pa.id,
          'pausa_motivo',         pa.motivo,
          'pausa_desde',          pa.pausada_at,
          'pausa_hasta',          pa.hasta_at,
          'pausada_por_nombre',   pa.pausada_por_nombre
        )
        order by v.ventana_inicio desc
      )
      from public.rondas_ventanas_historicas(p_objetivo_id, p_desde, p_hasta) v   -- [H] foto primero
      join public.rondas_base rb on rb.id = v.ronda_base_id
      join public.puestos     pu on pu.id = v.puesto_id
      join public.usuarios     g on  g.id = v.guardia_id

      left join lateral (
        select ex.*
        from public.ronda_ejecuciones ex
        where ex.ronda_base_id = v.ronda_base_id
          and ex.turno_id      = v.turno_id
          and ex.estado in ('en_curso', 'finalizada')
          and ex.iniciada_at  >= v.ventana_inicio
          and ex.iniciada_at  <  v.match_fin
        order by ex.iniciada_at asc
        limit 1
      ) e on true

      left join lateral (
        select
          count(*) filter (where ep.estado = 'cumplido')   as cumplidos,
          count(*) filter (where ep.estado = 'incumplido') as incumplidos,
          count(*) filter (where ep.estado = 'omitido')    as omitidos,
          count(*) filter (where ep.estado = 'pendiente_validacion') as pendientes_validacion  -- [REGLA]
        from public.ronda_ejecucion_puntos ep
        where ep.ronda_ejecucion_id = e.id
      ) cnt on true

      left join lateral (
        select a.*
        from public.ronda_alertas a
        where a.ronda_base_id = v.ronda_base_id
          and a.turno_id      = v.turno_id
          and (a.tipo = 'suspendida' or a.ventana_inicio = v.ventana_inicio)
        order by (a.tipo = 'suspendida') desc, a.detectada_at desc
        limit 1
      ) al on true

      left join public.usuarios rp on rp.id = al.resuelta_por
      left join lateral (
        select count(*) as total
        from public.ronda_alerta_intervenciones i
        where i.ronda_alerta_id = al.id
      ) iv on true

      -- Pausa que cubre esta ventana. Mismo criterio temporal que el evaluador:
      -- las tres ramas se mantienen para no perder el historial. Lo que se
      -- agrega es `vigente`, que distingue la pausa todavia en curso de la ya
      -- reanudada. Misma expresion que el campo homonimo de
      -- listar_rondas_pausadas: si cambia una, tiene que cambiar la otra.
      left join lateral (
        select px.*,
               (px.activa and (px.hasta_at is null or px.hasta_at > now())) as vigente,
               upx.apellido || ', ' || upx.nombre as pausada_por_nombre
        from public.ronda_pausas px
        join public.usuarios upx on upx.id = px.pausada_por
        where px.ronda_base_id = v.ronda_base_id
          and px.pausada_at <= v.ventana_inicio
          and (
            (px.activa = true and px.hasta_at is null)
            or (px.activa = true and px.hasta_at is not null and v.ventana_inicio < px.hasta_at)
            or (px.activa = false and px.reactivada_at is not null and v.ventana_inicio < px.reactivada_at)
          )
        order by px.pausada_at desc
        limit 1
      ) pa on true
      -- [H] Sólo lo que se exigía (o estaba pausado), como antes.
      where v.estado_exigencia in ('exigible', 'pausada')
    ), jsonb_build_array())
  );
end;
$fn$;

-- ============================================================================
-- 8. PERMISOS
-- ============================================================================
revoke all on function public.rondas_ventanas_candidatas(uuid, date, date)  from public, anon, authenticated;
revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public, anon, authenticated;
revoke all on function public.rondas_ventanas_historicas(uuid, date, date)  from public, anon, authenticated;
revoke all on function public.capturar_ventanas_exigidas(date, date)        from public, anon, authenticated;
revoke all on function public.ronda_ventanas_exigidas_inmutable()           from public, anon, authenticated;
revoke all on function public.evaluar_ronda_alertas()                       from public, anon, authenticated;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rondas_ventanas_candidatas(uuid, date, date)  to service_role;
    grant execute on function public.rondas_ventanas_programadas(uuid, date, date) to service_role;
    grant execute on function public.rondas_ventanas_historicas(uuid, date, date)  to service_role;
    grant execute on function public.capturar_ventanas_exigidas(date, date)        to service_role;
    grant execute on function public.evaluar_ronda_alertas()                       to service_role;
  end if;
end $g$;

notify pgrst, 'reload schema';

commit;

-- ── Verificación (sólo lectura, después de aplicar) ─────────────────────────
-- 1) La función de ventanas devuelve lo mismo que antes salvo los filtros
--    restituidos (comparar con el conteo previo del mismo rango):
--    select count(*) from public.rondas_ventanas_programadas(null, current_date - 7, current_date);
--    select estado_exigencia, count(*) from public.rondas_ventanas_candidatas(null, current_date - 7, current_date) group by 1;
-- 2) El cron fotografía (crece cada 10'):
--    select estado_exigencia, count(*), max(captured_at) from public.ronda_ventanas_exigidas group by 1;
-- 3) Origen del historial de un objetivo:
--    select origen, count(*) from public.rondas_ventanas_historicas('<objetivo>', current_date - 3, current_date) group by 1;
-- 4) Una foto no cambia (debe fallar con «historial inmutable»):
--    update public.ronda_ventanas_exigidas set motivo = 'x' where false;  -- 0 filas: no dispara; probar en una copia
