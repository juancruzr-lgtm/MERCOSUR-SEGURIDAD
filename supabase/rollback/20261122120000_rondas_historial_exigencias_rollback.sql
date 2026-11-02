-- Rollback de 20261122120000_rondas_historial_exigencias.sql
--
-- Vuelven, textuales, las definiciones previas:
--   · rondas_ventanas_programadas  ← 20261104120000 (= producción al 02/11/2026,
--     md5 del cuerpo 986d64cd17478cd32876951a3eb8520e);
--   · evaluar_ronda_alertas        ← 20261115120000;
--   · cumplimiento_rondas_por_empleado / _servicio ← 20261120150000;
--   · listar_rondas_programadas_objetivo ← 20261120120000.
-- Se borran las funciones nuevas (candidatas, históricas, captura).
--
-- La tabla ronda_ventanas_exigidas QUEDA, con sus fotos y su protección: es
-- historial y nadie la lee después del rollback. Reaplicar la migración la
-- retoma donde quedó (ON CONFLICT DO NOTHING). Para borrarla, decisión aparte:
--   drop table public.ronda_ventanas_exigidas;   -- pierde el historial
-- ronda_horarios_sin_exigencia (reconciliación) tampoco se toca: ya existía.

begin;

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

comment on function public.rondas_ventanas_programadas(uuid, date, date) is null;

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

  for r in
    select *
    from public.rondas_ventanas_programadas(
      null,
      v_hoy - v_lookback_dias,
      v_hoy
    )
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

      -- ¿Hay un episodio de esta ronda y turno que cubra la ventana? Una alerta
      -- por episodio: la ventana nueva se agrupa como contador y no genera otra
      -- alerta ni otro aviso. Cubren: la alerta abierta (pendiente o en
      -- seguimiento), la cerrada como 'no_resuelto' (incumplimiento confirmado
      -- del turno) y la cerrada como 'resuelto' por un motivo que vale para
      -- todo el turno (error técnico, administrativa, otro). NO cubre la
      -- cerrada como 'resuelto' por ronda realizada: la ronda se retomó, y una
      -- ventana incumplida después es un incumplimiento nuevo. Las cerradas sin
      -- resultado (historial previo a este cambio) no cubren nada.
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

  -- Cierre automático por inicio tarde. Medido en producción (octubre 2026):
  -- de 353 'no_iniciada', ninguna tenía la ejecución dentro de su propia
  -- ventana —el vencimiento ya incluye la tolerancia—; 178 sí tenían una
  -- ejecución posterior en el MISMO turno (el vigilador retomó en la ventana
  -- siguiente, o subió tarde una ronda hecha sin señal). Esas alertas
  -- quedaban pendientes para siempre. Se cierran solas: resultado 'resuelto',
  -- motivo 'ronda_realizada', intervención de origen 'sistema'. Cumplimiento
  -- no cambia (mide por ejecución; la acción queda 'resuelta', no
  -- 'justificacion'). Sólo episodios de UNA ventana: si se agruparon otras,
  -- el supervisor decide. Acotado al mismo lookback del evaluador.
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
      from public.rondas_ventanas_programadas(null, p_desde, p_hasta) x
     where x.vencimiento_at < now()
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
      from public.rondas_ventanas_programadas(null, p_desde, p_hasta) x
     where x.vencimiento_at < now()
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
      from public.rondas_ventanas_programadas(p_objetivo_id, p_desde, p_hasta) v
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
    ), jsonb_build_array())
  );
end;
$fn$;

drop function if exists public.rondas_ventanas_historicas(uuid, date, date);
drop function if exists public.capturar_ventanas_exigidas(date, date);
drop function if exists public.rondas_ventanas_candidatas(uuid, date, date);

revoke all on function public.rondas_ventanas_programadas(uuid, date, date) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
