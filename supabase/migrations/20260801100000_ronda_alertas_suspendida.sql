-- ============================================================================
-- ALERTAS DE RONDAS · Suspensión por el vigilador
-- ============================================================================
-- El vigilador puede declarar una ronda "suspendida" (no puede hacerla por una
-- tarea), aclarando el motivo. Se reutiliza ronda_alertas (nuevo tipo
-- 'suspendida'): el supervisor la ve en su pestaña Alertas, el cron la notifica
-- por zona y queda registro. No toca asistencia, liquidables, JWM ni la
-- ejecución normal de rondas.

begin;

-- Motivo declarado por el vigilador (perdura aunque el supervisor comente/resuelva).
alter table public.ronda_alertas
  add column if not exists motivo_vigilador text;

-- Amplía los tipos permitidos.
alter table public.ronda_alertas drop constraint if exists ronda_alertas_tipo_check;
alter table public.ronda_alertas
  add constraint ronda_alertas_tipo_check
  check (tipo in ('no_iniciada', 'no_finalizada', 'suspendida'));

-- ── RPC: el vigilador del turno vigente suspende una ronda de su puesto ──────
create or replace function public.suspender_ronda(
  p_ronda_base_id uuid,
  p_motivo        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ctx          record;
  v_motivo       text := btrim(coalesce(p_motivo, ''));
  v_ronda_nombre text;
  v_ejecucion_id uuid;
  v_vi           timestamptz;
  v_vf           timestamptz;
  v_alerta_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'Sesion requerida';
  end if;

  select * into v_ctx from public.rondas_turno_vigente();
  if v_ctx.turno_id is null then
    return jsonb_build_object('contexto', 'sin_turno_vigente', 'alerta_id', null);
  end if;

  if length(v_motivo) < 3 then
    return jsonb_build_object('contexto', 'motivo_invalido', 'alerta_id', null);
  end if;

  -- La ronda debe pertenecer al puesto del turno vigente.
  select rb.nombre into v_ronda_nombre
  from public.rondas_base rb
  where rb.id = p_ronda_base_id
    and rb.puesto_id = v_ctx.puesto_id
    and rb.activo;
  if not found then
    return jsonb_build_object('contexto', 'ronda_no_disponible', 'alerta_id', null);
  end if;

  -- Ventana estable por turno: una suspensión activa por (ronda, turno).
  select (t.fecha + t.hora_inicio) at time zone 'America/Argentina/Buenos_Aires',
         (t.fecha + t.hora_fin
           + case when t.hora_fin <= t.hora_inicio then interval '1 day' else interval '0' end)
           at time zone 'America/Argentina/Buenos_Aires'
    into v_vi, v_vf
  from public.turnos t
  where t.id = v_ctx.turno_id;

  select e.id into v_ejecucion_id
  from public.ronda_ejecuciones e
  where e.ronda_base_id = p_ronda_base_id
    and e.turno_id      = v_ctx.turno_id
    and e.estado        = 'en_curso'
  limit 1;

  insert into public.ronda_alertas (
    objetivo_id, puesto_id, ronda_base_id, turno_id, guardia_id, ejecucion_id,
    tipo, ventana_inicio, ventana_fin, vencimiento_at, estado, motivo_vigilador
  ) values (
    v_ctx.objetivo_id, v_ctx.puesto_id, p_ronda_base_id, v_ctx.turno_id, v_ctx.usuario_id, v_ejecucion_id,
    'suspendida', v_vi, v_vf, v_vf, 'pendiente', v_motivo
  )
  on conflict (ronda_base_id, turno_id, ventana_inicio, tipo) do update
    set motivo_vigilador = excluded.motivo_vigilador,
        ejecucion_id     = coalesce(excluded.ejecucion_id, ronda_alertas.ejecucion_id),
        updated_at       = now()
    where ronda_alertas.estado = 'pendiente'
  returning id into v_alerta_id;

  -- Si el conflicto no actualizó (ya resuelta), devolver el id existente.
  if v_alerta_id is null then
    select id into v_alerta_id
    from public.ronda_alertas
    where ronda_base_id = p_ronda_base_id and turno_id = v_ctx.turno_id
      and ventana_inicio = v_vi and tipo = 'suspendida';
  end if;

  return jsonb_build_object(
    'contexto', 'suspendida',
    'alerta_id', v_alerta_id,
    'ronda_nombre', v_ronda_nombre
  );
end;
$$;

revoke all on function public.suspender_ronda(uuid, text) from public;
revoke all on function public.suspender_ronda(uuid, text) from anon;
grant execute on function public.suspender_ronda(uuid, text) to authenticated;

-- ── Recrea listar_ronda_alertas_objetivo agregando motivo_vigilador ─────────
create or replace function public.listar_ronda_alertas_objetivo(
  p_objetivo_id uuid,
  p_estado      text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('contexto', 'sin_usuario', 'alertas', jsonb_build_array());
  end if;
  if not public.puede_administrar_rondas_objetivo(p_objetivo_id) then
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
        order by a.detectada_at desc
      )
      from public.ronda_alertas a
      join public.rondas_base rb on rb.id = a.ronda_base_id
      join public.puestos    pu on pu.id = a.puesto_id
      join public.usuarios    g on  g.id = a.guardia_id
      left join public.usuarios rp on rp.id = a.resuelta_por
      where a.objetivo_id = p_objetivo_id
        and (p_estado is null or a.estado = p_estado)
    ), jsonb_build_array())
  );
end;
$$;

revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from public;
revoke all on function public.listar_ronda_alertas_objetivo(uuid, text) from anon;
grant execute on function public.listar_ronda_alertas_objetivo(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
