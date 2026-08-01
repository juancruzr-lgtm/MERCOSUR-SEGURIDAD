-- ============================================================================
-- RONDAS · Pausa y reanudación de rondas por supervisor
-- ============================================================================
--
-- Modelo: tabla `ronda_pausas` con historial completo, índice parcial para
-- garantizar máximo una pausa activa por ronda_base, y 3 RPCs SECURITY DEFINER.
--
-- Modifica: `evaluar_ronda_alertas()` (agrega chequeo de pausa por ventana y
-- auto-reactivación de pausas vencidas) y `listar_rondas_programadas_objetivo()`
-- (agrega LEFT JOIN LATERAL para anotar cada ventana con su estado de pausa).
--
-- No toca: `rondas_ventanas_programadas()` (firma ni cuerpo), `ronda_alertas`
-- (las alertas anteriores se preservan), ni la lógica de ejecución del vigilador.

begin;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 1. TABLA                                                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create table public.ronda_pausas (
  id                       uuid        primary key default gen_random_uuid(),
  ronda_base_id            uuid        not null references public.rondas_base(id) on delete restrict,
  objetivo_id              uuid        not null references public.objetivos(id) on delete restrict,
  puesto_id                uuid        not null references public.puestos(id) on delete restrict,
  pausada_por              uuid        not null references public.usuarios(id) on delete restrict,
  pausada_at               timestamptz not null default now(),
  motivo                   text        not null check (length(trim(motivo)) >= 5),
  hasta_at                 timestamptz,
  activa                   boolean     not null default true,
  reactivada_por           uuid        references public.usuarios(id) on delete restrict,
  reactivada_at            timestamptz,
  reactivada_comentario    text,
  reactivacion_automatica  boolean     not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint pausa_activa_sin_reactivacion
    check (not activa or reactivada_at is null),
  constraint pausa_inactiva_con_reactivacion
    check (activa or reactivada_at is not null),
  constraint hasta_posterior_a_pausada
    check (hasta_at is null or hasta_at > pausada_at)
);

create unique index ronda_pausas_una_activa
  on public.ronda_pausas (ronda_base_id)
  where activa = true;

create index idx_ronda_pausas_objetivo
  on public.ronda_pausas (objetivo_id);

create index idx_ronda_pausas_ronda_base
  on public.ronda_pausas (ronda_base_id);

create index idx_ronda_pausas_activas_vigentes
  on public.ronda_pausas (ronda_base_id, pausada_at)
  where activa = true;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 2. RLS Y PERMISOS                                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

alter table public.ronda_pausas enable row level security;

create policy "Lectura pausas para supervisores autorizados"
  on public.ronda_pausas
  for select
  to authenticated
  using (public.puede_administrar_rondas_objetivo(objetivo_id));

revoke insert, update, delete on public.ronda_pausas from anon;
revoke insert, update, delete on public.ronda_pausas from authenticated;
grant select on public.ronda_pausas to authenticated;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 3. RPC pausar_ronda                                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create or replace function public.pausar_ronda(
  p_ronda_base_id uuid,
  p_motivo        text,
  p_hasta_at      timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid         uuid := auth.uid();
  v_usuario_id  uuid;
  v_objetivo_id uuid;
  v_puesto_id   uuid;
  v_pausa       record;
  v_alertas_ant bigint;
begin
  if v_uid is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo';
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select rb.objetivo_id, rb.puesto_id
    into v_objetivo_id, v_puesto_id
  from public.rondas_base rb
  where rb.id = p_ronda_base_id and rb.activo;
  if v_objetivo_id is null then
    return jsonb_build_object('contexto', 'ronda_no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  if length(trim(coalesce(p_motivo, ''))) < 5 then
    return jsonb_build_object('contexto', 'motivo_invalido');
  end if;

  if p_hasta_at is not null and p_hasta_at <= now() then
    return jsonb_build_object('contexto', 'hasta_invalido');
  end if;

  if exists (
    select 1 from public.ronda_pausas
    where ronda_base_id = p_ronda_base_id and activa = true
  ) then
    return jsonb_build_object('contexto', 'ya_pausada');
  end if;

  insert into public.ronda_pausas (
    ronda_base_id, objetivo_id, puesto_id, pausada_por, motivo, hasta_at
  ) values (
    p_ronda_base_id, v_objetivo_id, v_puesto_id, v_usuario_id, trim(p_motivo), p_hasta_at
  )
  returning * into v_pausa;

  select count(*) into v_alertas_ant
  from public.ronda_alertas
  where ronda_base_id = p_ronda_base_id
    and estado = 'pendiente';

  return jsonb_build_object(
    'contexto', 'ok',
    'pausa', jsonb_build_object(
      'id',              v_pausa.id,
      'ronda_base_id',   v_pausa.ronda_base_id,
      'objetivo_id',     v_pausa.objetivo_id,
      'puesto_id',       v_pausa.puesto_id,
      'pausada_por',     v_pausa.pausada_por,
      'pausada_por_nombre', (
        select u.apellido || ', ' || u.nombre
        from public.usuarios u where u.id = v_usuario_id
      ),
      'pausada_at',      v_pausa.pausada_at,
      'motivo',          v_pausa.motivo,
      'hasta_at',        v_pausa.hasta_at,
      'activa',          v_pausa.activa
    ),
    'alertas_pendientes_anteriores', v_alertas_ant
  );
end;
$$;

revoke all on function public.pausar_ronda(uuid, text, timestamptz) from public;
revoke all on function public.pausar_ronda(uuid, text, timestamptz) from anon;
grant execute on function public.pausar_ronda(uuid, text, timestamptz) to authenticated;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 4. RPC reanudar_ronda                                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create or replace function public.reanudar_ronda(
  p_pausa_id              uuid,
  p_reactivada_comentario text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid        uuid := auth.uid();
  v_usuario_id uuid;
  v_pausa      record;
begin
  if v_uid is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo';
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  select * into v_pausa
  from public.ronda_pausas
  where id = p_pausa_id;
  if not found then
    return jsonb_build_object('contexto', 'pausa_no_encontrada');
  end if;

  if not v_pausa.activa then
    return jsonb_build_object('contexto', 'ya_reactivada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_pausa.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  update public.ronda_pausas
  set activa                  = false,
      reactivada_por          = v_usuario_id,
      reactivada_at           = now(),
      reactivada_comentario   = p_reactivada_comentario,
      reactivacion_automatica = false,
      updated_at              = now()
  where id = p_pausa_id;

  return jsonb_build_object(
    'contexto', 'ok',
    'pausa', jsonb_build_object(
      'id',                     v_pausa.id,
      'ronda_base_id',          v_pausa.ronda_base_id,
      'activa',                 false,
      'reactivada_por',         v_usuario_id,
      'reactivada_por_nombre',  (
        select u.apellido || ', ' || u.nombre
        from public.usuarios u where u.id = v_usuario_id
      ),
      'reactivada_at',          now(),
      'reactivada_comentario',  p_reactivada_comentario,
      'reactivacion_automatica', false
    )
  );
end;
$$;

revoke all on function public.reanudar_ronda(uuid, text) from public;
revoke all on function public.reanudar_ronda(uuid, text) from anon;
grant execute on function public.reanudar_ronda(uuid, text) to authenticated;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 5. RPC listar_rondas_pausadas                                               ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create or replace function public.listar_rondas_pausadas(
  p_objetivo_id  uuid    default null,
  p_solo_activas boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid        uuid := auth.uid();
  v_usuario_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'pausas', jsonb_build_array());
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = v_uid and u.estado = 'activo';

  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'pausas', jsonb_build_array());
  end if;

  if p_objetivo_id is not null
     and not public.puede_administrar_rondas_objetivo(p_objetivo_id)
  then
    return jsonb_build_object('contexto', 'sin_permiso', 'pausas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'pausas', coalesce((
      select jsonb_agg(fila order by fila->>'activa' desc, fila->>'pausada_at' desc)
      from (
        select jsonb_build_object(
          'id',                     p.id,
          'ronda_base_id',          p.ronda_base_id,
          'ronda_nombre',           rb.nombre,
          'objetivo_id',            p.objetivo_id,
          'objetivo_nombre',        o.nombre,
          'puesto_id',              p.puesto_id,
          'puesto_nombre',          pu.nombre,
          'pausada_por',            p.pausada_por,
          'pausada_por_nombre',     up.apellido || ', ' || up.nombre,
          'pausada_at',             p.pausada_at,
          'motivo',                 p.motivo,
          'hasta_at',               p.hasta_at,
          'activa',                 p.activa,
          'vigente',                (p.activa and (p.hasta_at is null or p.hasta_at > now())),
          'reactivada_por',         p.reactivada_por,
          'reactivada_por_nombre',
            case when p.reactivada_por is null then null
                 else ur.apellido || ', ' || ur.nombre end,
          'reactivada_at',          p.reactivada_at,
          'reactivada_comentario',  p.reactivada_comentario,
          'reactivacion_automatica', p.reactivacion_automatica
        ) as fila
        from public.ronda_pausas p
        join public.rondas_base rb on rb.id = p.ronda_base_id
        join public.objetivos    o on  o.id = p.objetivo_id
        join public.puestos     pu on pu.id = p.puesto_id
        join public.usuarios    up on up.id = p.pausada_por
        left join public.usuarios ur on ur.id = p.reactivada_por
        where (p_objetivo_id is null or p.objetivo_id = p_objetivo_id)
          and (not p_solo_activas or p.activa)
          and public.puede_administrar_rondas_objetivo(p.objetivo_id)
      ) sub
    ), jsonb_build_array())
  );
end;
$$;

revoke all on function public.listar_rondas_pausadas(uuid, boolean) from public;
revoke all on function public.listar_rondas_pausadas(uuid, boolean) from anon;
grant execute on function public.listar_rondas_pausadas(uuid, boolean) to authenticated;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 6. MODIFICAR evaluar_ronda_alertas — chequeo de pausa por ventana           ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- Cambios respecto de 20260801140000:
--   1. Auto-reactivación de pausas vencidas (UPDATE idempotente antes del loop).
--   2. Chequeo de pausa por ventana: si la ventana cayó dentro de una pausa,
--      no generar alerta (CONTINUE).
-- Todo lo demás se conserva sin cambios.

create or replace function public.evaluar_ronda_alertas()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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

    if v_tipo is not null then
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
    end if;
  end loop;

  return v_afectadas;
end;
$$;

revoke all on function public.evaluar_ronda_alertas() from public;
revoke all on function public.evaluar_ronda_alertas() from anon;
revoke all on function public.evaluar_ronda_alertas() from authenticated;
grant execute on function public.evaluar_ronda_alertas() to service_role;

-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ 7. MODIFICAR listar_rondas_programadas_objetivo — anexo de pausa            ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- Cambios respecto de 20260801160000:
--   1. LEFT JOIN LATERAL contra ronda_pausas con el mismo criterio temporal.
--   2. 6 columnas nuevas: pausada, pausa_id, pausa_motivo, pausa_desde,
--      pausa_hasta, pausada_por_nombre.
--   3. El CASE de estado incluye 'pausada' cuando no hay ejecución y la
--      ventana cae dentro de una pausa.
-- Firma, grants y semántica restante sin cambios.

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
as $$
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
              when e.id is not null                              then 'incompleta'
              when pa.id is not null                             then 'pausada'
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
          'pausada',              (pa.id is not null),
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
          count(*) filter (where ep.estado = 'omitido')    as omitidos
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

      -- Pausa que cubre esta ventana. Mismo criterio temporal que el evaluador.
      left join lateral (
        select px.*,
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
$$;

comment on function public.listar_rondas_programadas_objetivo(uuid, date, date) is
  'Historial de rondas PROGRAMADAS de un objetivo: una fila por ventana, exista '
  'o no ejecución. El estado se deriva de programación + ejecución; los campos '
  'alerta_* y pausa_* son anexo informativo y no condicionan filas ni estados.';

revoke all on function public.listar_rondas_programadas_objetivo(uuid, date, date) from public;
revoke all on function public.listar_rondas_programadas_objetivo(uuid, date, date) from anon;
grant execute on function public.listar_rondas_programadas_objetivo(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
