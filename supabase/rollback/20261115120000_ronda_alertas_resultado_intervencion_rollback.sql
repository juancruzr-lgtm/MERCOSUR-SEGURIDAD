-- Rollback de 20261115120000_ronda_alertas_resultado_intervencion.sql
--
-- Vuelve resolver_ronda_alerta (firma de 3 argumentos), evaluar_ronda_alertas y
-- listar_ronda_alertas_objetivo a las definiciones vivas en producción al
-- 02/11/2026 (pg_get_functiondef).
--
-- Historial: NO se borra nada.
--   · Las ventanas agrupadas en episodios se materializan como alertas propias
--     ya CERRADAS (comentario con la alerta del episodio). Si sólo se borrara la
--     tabla, el evaluador viejo recrearía esas ventanas como pendientes dentro
--     de su lookback de 2 días y push/WhatsApp las avisarían de golpe.
--   · Las columnas nuevas (resultado, motivo, seguimiento, origen, contador)
--     quedan, sin uso: borrarlas perdería lo que registraron los supervisores.
--     supervisor_id queda admitiendo NULL (las filas de origen 'sistema' lo
--     tienen; evaluacion_rondas_atribuidas ya filtra supervisor_id is not null).

begin;

do $do$
begin
  if to_regclass('public.ronda_alerta_ventanas_episodio') is not null then
    insert into public.ronda_alertas (
      objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
      tipo, ventana_inicio, ventana_fin, vencimiento_at, detectada_at,
      estado, resuelta_at, accion, comentario
    )
    select a.objetivo_id, a.puesto_id, w.ronda_base_id, w.turno_id, a.guardia_id, w.ejecucion_id,
           w.tipo, w.ventana_inicio, w.ventana_fin, w.vencimiento_at, w.detectada_at,
           'resuelta', now(), 'resuelta',
           'Rollback 20261115120000: ventana agrupada en la alerta ' || a.id::text
      from public.ronda_alerta_ventanas_episodio w
      join public.ronda_alertas a on a.id = w.ronda_alerta_id
    on conflict (ronda_base_id, turno_id, ventana_inicio, tipo) do nothing;
  end if;
end;
$do$;

drop table if exists public.ronda_alerta_ventanas_episodio;

drop function if exists public.resolver_ronda_alerta(uuid, text, text, text, text, integer, integer);

create or replace function public.resolver_ronda_alerta(p_alerta_id uuid, p_accion text, p_comentario text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_usuario_id uuid;
  v_alerta     record;
  v_comentario text := btrim(coalesce(p_comentario, ''));
  v_cerrar     jsonb;
  v_cerrar_ctx text;
  v_cierra     boolean;
  v_pendiente  boolean;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select u.id into v_usuario_id
  from public.usuarios u
  where u.auth_user_id = auth.uid() and u.estado = 'activo'
  limit 1;
  if v_usuario_id is null then
    return jsonb_build_object('contexto', 'sin_usuario');
  end if;

  if p_accion not in ('llamada_vigilador', 'solicitud_cumplimiento',
                      'justificacion', 'cierre_administrativo', 'resuelta') then
    return jsonb_build_object('contexto', 'accion_invalida');
  end if;

  -- Serializa dos supervisores sobre la misma alerta.
  select * into v_alerta
  from public.ronda_alertas
  where id = p_alerta_id
  for update;
  if not found then
    return jsonb_build_object('contexto', 'no_encontrada');
  end if;

  if not public.puede_administrar_rondas_objetivo(v_alerta.objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso');
  end if;

  v_cierra := p_accion in ('justificacion', 'cierre_administrativo', 'resuelta');

  if v_cierra and v_comentario = '' then
    return jsonb_build_object('contexto', 'comentario_requerido');
  end if;

  -- Idempotencia: una alerta ya resuelta no se reabre ni se re-registra.
  if v_alerta.estado = 'resuelta' then
    return jsonb_build_object('contexto', 'ya_resuelta', 'alerta_id', v_alerta.id);
  end if;

  -- ── Cierre administrativo: la ejecución se cierra por su única vía.
  if p_accion = 'cierre_administrativo' then
    if v_alerta.ejecucion_id is null then
      return jsonb_build_object('contexto', 'cierre_no_aplicable', 'alerta_id', v_alerta.id);
    end if;

    v_cerrar := public.cerrar_ronda_bloqueada(v_alerta.ejecucion_id, v_comentario);
    v_cerrar_ctx := v_cerrar->>'contexto';

    if v_cerrar_ctx not in ('cerrada', 'ya_cerrada') then
      return jsonb_build_object('contexto', v_cerrar_ctx, 'alerta_id', v_alerta.id);
    end if;

    select (a.estado = 'pendiente') into v_pendiente
    from public.ronda_alertas a
    where a.id = v_alerta.id;

    if v_pendiente then
      insert into public.ronda_alerta_intervenciones
        (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
      values
        (v_alerta.id, v_usuario_id, 'cierre_administrativo', v_comentario, 'pendiente', 'resuelta');

      update public.ronda_alertas
         set estado       = 'resuelta',
             resuelta_por = v_usuario_id,
             resuelta_at  = now(),
             accion       = 'cierre_administrativo',
             comentario   = v_comentario,
             updated_at   = now()
       where id = v_alerta.id;
    end if;

    return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
  end if;

  -- ── Acciones que NO cierran: llamada_vigilador / solicitud_cumplimiento.
  if not v_cierra then
    insert into public.ronda_alerta_intervenciones
      (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
    values
      (v_alerta.id, v_usuario_id, p_accion, nullif(v_comentario, ''), 'pendiente', 'pendiente');

    update public.ronda_alertas
       set accion     = p_accion,
           comentario = nullif(v_comentario, ''),
           updated_at = now()
     where id = v_alerta.id;

    return jsonb_build_object('contexto', 'registrada', 'alerta_id', v_alerta.id);
  end if;

  -- ── Acciones que cierran directamente: justificacion / resuelta.
  insert into public.ronda_alerta_intervenciones
    (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
  values
    (v_alerta.id, v_usuario_id, p_accion, v_comentario, 'pendiente', 'resuelta');

  update public.ronda_alertas
     set estado       = 'resuelta',
         resuelta_por = v_usuario_id,
         resuelta_at  = now(),
         accion       = p_accion,
         comentario   = v_comentario,
         updated_at   = now()
   where id = v_alerta.id;

  return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
end;
$function$;

revoke all on function public.resolver_ronda_alerta(uuid, text, text) from public, anon;
grant execute on function public.resolver_ronda_alerta(uuid, text, text) to authenticated, service_role;

create or replace function public.evaluar_ronda_alertas()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
$function$;

create or replace function public.listar_ronda_alertas_objetivo(p_objetivo_id uuid default null::uuid, p_estado text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'alertas', jsonb_build_array());
  end if;

  -- Objetivo explícito: se valida el permiso sobre ese objetivo, como siempre.
  if p_objetivo_id is not null
     and not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
    return jsonb_build_object('contexto', 'sin_permiso', 'alertas', jsonb_build_array());
  end if;

  if p_estado is not null and p_estado not in ('pendiente', 'resuelta') then
    return jsonb_build_object('contexto', 'parametro_invalido', 'alertas', jsonb_build_array());
  end if;

  return jsonb_build_object(
    'contexto', 'ok',
    'alertas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',              a.id,
          'tipo',            a.tipo,
          'estado',          a.estado,
          'objetivo_id',     a.objetivo_id,
          'objetivo_nombre', ob.nombre,
          'puesto_id',       a.puesto_id,
          'puesto_nombre',   pu.nombre,
          'ronda_base_id',   a.ronda_base_id,
          'ronda_nombre',    rb.nombre,
          'turno_id',        a.turno_id,
          'guardia_id',      a.guardia_id,
          'guardia_nombre',  g.apellido || ', ' || g.nombre,
          'ejecucion_id',    a.ejecucion_id,
          'ventana_inicio',  a.ventana_inicio,
          'ventana_fin',     a.ventana_fin,
          'vencimiento_at',  a.vencimiento_at,
          'detectada_at',    a.detectada_at,
          'resuelta_por',    a.resuelta_por,
          'resuelta_por_nombre', case when a.resuelta_por is null then null
                                      else rp.apellido || ', ' || rp.nombre end,
          'resuelta_at',     a.resuelta_at,
          'accion',          a.accion,
          'comentario',      a.comentario,
          'motivo_vigilador',a.motivo_vigilador,
          'intervenciones',  (select count(*) from public.ronda_alerta_intervenciones i
                                where i.ronda_alerta_id = a.id)
        )
        -- Lo más vencido primero: es el orden en que hay que atenderlas.
        order by a.vencimiento_at asc, a.detectada_at desc
      )
      from public.ronda_alertas a
      join public.rondas_base rb on rb.id = a.ronda_base_id
      join public.puestos    pu on pu.id = a.puesto_id
      join public.objetivos  ob on ob.id = a.objetivo_id
      join public.usuarios    g on  g.id = a.guardia_id
      left join public.usuarios rp on rp.id = a.resuelta_por
      where (p_estado is null or a.estado = p_estado)
        and (
          case
            when p_objetivo_id is not null then a.objetivo_id = p_objetivo_id
            -- Alcance completo: solo objetivos autorizados y nunca de prueba.
            else ob.es_prueba = false
                 and public.puede_administrar_rondas_objetivo(a.objetivo_id)
          end
        )
    ), jsonb_build_array())
  );
end;
$function$;

commit;
