-- ============================================================================
-- SIN APLICAR — Resultado de la intervención en alertas de ronda (auditoría oct-2026)
-- ============================================================================
-- Hechos verificados en producción (octubre 2026, sólo lectura):
--   · 386 alertas de ronda, 328 todavía 'pendiente'. resolver_ronda_alerta con
--     llamada_vigilador / solicitud_cumplimiento registraba pendiente→pendiente
--     y la alerta NUNCA se cerraba: el supervisor "intervenía" y la alerta seguía
--     contando como sin atender (y alimentando push y WhatsApp).
--   · evaluar_ronda_alertas creaba una alerta por VENTANA aunque la misma ronda y
--     turno ya tuviera una alerta intervenida: un vigilador que no hacía rondas
--     en toda la noche generaba 5–6 alertas y 5–6 avisos.
--   · Una ronda iniciada tarde dentro del turno no cerraba la alerta 'no_iniciada'.
--   · Intervenciones idénticas repetidas en el mismo minuto (5–6 clics).
--
-- Qué cambia:
--   1) ronda_alerta_intervenciones: `resultado` (resuelto / seguimiento /
--      no_resuelto), `motivo`, `seguimiento_hasta` y `origen` (supervisor /
--      sistema). Nulos en el historial: nada se reescribe. supervisor_id pasa a
--      admitir NULL sólo para las filas de origen 'sistema'.
--   2) ronda_alertas: `resultado_intervencion` (el último resultado),
--      `motivo_intervencion`, `seguimiento_hasta`, `ventanas_adicionales` y
--      `ultima_ventana_inicio` (contador del episodio).
--   3) ronda_alerta_ventanas_episodio: las ventanas posteriores de la misma ronda
--      y turno que se AGRUPAN en la alerta abierta en lugar de crear otra alerta
--      (y otro aviso). Conserva cada ventana con su detección: no se pierde
--      historial. Misma clave única que ronda_alertas.
--   4) resolver_ronda_alerta(p_alerta_id, p_accion, p_comentario, p_resultado,
--      p_motivo, p_seguimiento_minutos, p_intervenciones_esperadas):
--        · sin p_resultado → comportamiento anterior (clientes viejos y
--          cerrar_ronda_alertas_pendientes siguen funcionando igual);
--        · 'resuelto'     → cierra (estado 'resuelta');
--        · 'no_resuelto'  → cierra como incumplimiento confirmado;
--        · 'seguimiento'  → sigue pendiente hasta seguimiento_hasta (15 a 240
--          min, 120 por defecto). Vencido, la alerta vuelve a pedir un resultado
--          definitivo: un segundo seguimiento se rechaza.
--        · bloqueo optimista: con p_intervenciones_esperadas, si la alerta cambió
--          (otra intervención o ya cerrada) devuelve 'conflicto' con la última
--          intervención, sin escribir nada.
--        · idempotencia: la misma intervención del mismo usuario dentro de 60 s
--          devuelve 'duplicada' y no inserta otra fila.
--   5) evaluar_ronda_alertas (base: definición viva = 20260802200000 + parches
--      posteriores, leída con pg_get_functiondef el 02/11/2026):
--        · una alerta por EPISODIO de ronda+turno: si ya hay una alerta abierta
--          (pendiente, en seguimiento) o cerrada como 'no_resuelto' / 'resuelto'
--          (salvo 'resuelto' por ronda realizada: la ronda se retomó y la
--          próxima ventana incumplida es un episodio nuevo), la ventana nueva
--          se agrupa como contador en esa alerta;
--        · la 'no_iniciada' cuya ronda se inició después, dentro del MISMO
--          turno, se cierra sola: resultado 'resuelto', motivo
--          'ronda_realizada', intervención de origen 'sistema'. Sólo si el
--          episodio no acumuló otras ventanas: si las hubo, las decide el
--          supervisor. NO toca métricas: la acción queda 'resuelta' (no
--          'justificacion'), así Cumplimiento sigue contando la demora.
--   6) listar_ronda_alertas_objetivo: expone los campos nuevos, si el
--      seguimiento venció y la última intervención (para el aviso de conflicto).
--
-- Rollback: supabase/rollback/20261115120000_ronda_alertas_resultado_intervencion_rollback.sql
-- Pruebas:  supabase/pruebas/alertas-intervenciones/ (PGlite, ver README)
-- ============================================================================

begin;

-- ── 1) Intervenciones: resultado, motivo, seguimiento, origen ────────────────
alter table public.ronda_alerta_intervenciones
  add column if not exists resultado text,
  add column if not exists motivo text,
  add column if not exists seguimiento_hasta timestamptz,
  add column if not exists origen text not null default 'supervisor';

alter table public.ronda_alerta_intervenciones drop constraint if exists ronda_alerta_intervenciones_resultado_check;
alter table public.ronda_alerta_intervenciones add constraint ronda_alerta_intervenciones_resultado_check
  check (resultado is null or resultado in ('resuelto', 'seguimiento', 'no_resuelto'));
alter table public.ronda_alerta_intervenciones drop constraint if exists ronda_alerta_intervenciones_motivo_check;
alter table public.ronda_alerta_intervenciones add constraint ronda_alerta_intervenciones_motivo_check
  check (motivo is null or motivo in ('ronda_realizada', 'error_tecnico', 'administrativa', 'incumplimiento', 'otro'));
alter table public.ronda_alerta_intervenciones drop constraint if exists ronda_alerta_intervenciones_origen_check;
alter table public.ronda_alerta_intervenciones add constraint ronda_alerta_intervenciones_origen_check
  check (origen in ('supervisor', 'sistema'));
-- Seguimiento siempre con plazo; el plazo sólo existe en un seguimiento.
alter table public.ronda_alerta_intervenciones drop constraint if exists ronda_alerta_intervenciones_seguimiento_check;
alter table public.ronda_alerta_intervenciones add constraint ronda_alerta_intervenciones_seguimiento_check
  check ((resultado = 'seguimiento') = (seguimiento_hasta is not null) or resultado is null);

-- El cierre automático no tiene supervisor: sólo el origen 'sistema' admite NULL.
alter table public.ronda_alerta_intervenciones alter column supervisor_id drop not null;
alter table public.ronda_alerta_intervenciones drop constraint if exists ronda_alerta_intervenciones_actor_check;
alter table public.ronda_alerta_intervenciones add constraint ronda_alerta_intervenciones_actor_check
  check (origen = 'sistema' or supervisor_id is not null);

create index if not exists ronda_alerta_intervenciones_alerta_fecha_idx
  on public.ronda_alerta_intervenciones (ronda_alerta_id, created_at desc);

-- ── 2) Alertas: resultado vigente y contador del episodio ────────────────────
alter table public.ronda_alertas
  add column if not exists resultado_intervencion text,
  add column if not exists motivo_intervencion text,
  add column if not exists seguimiento_hasta timestamptz,
  add column if not exists ventanas_adicionales integer not null default 0,
  add column if not exists ultima_ventana_inicio timestamptz;

alter table public.ronda_alertas drop constraint if exists ronda_alertas_resultado_intervencion_check;
alter table public.ronda_alertas add constraint ronda_alertas_resultado_intervencion_check
  check (resultado_intervencion is null or resultado_intervencion in ('resuelto', 'seguimiento', 'no_resuelto'));
alter table public.ronda_alertas drop constraint if exists ronda_alertas_motivo_intervencion_check;
alter table public.ronda_alertas add constraint ronda_alertas_motivo_intervencion_check
  check (motivo_intervencion is null or motivo_intervencion in ('ronda_realizada', 'error_tecnico', 'administrativa', 'incumplimiento', 'otro'));
alter table public.ronda_alertas drop constraint if exists ronda_alertas_ventanas_adicionales_check;
alter table public.ronda_alertas add constraint ronda_alertas_ventanas_adicionales_check
  check (ventanas_adicionales >= 0);

-- Para buscar el episodio abierto de una ronda+turno en cada corrida del cron.
create index if not exists ronda_alertas_ronda_turno_idx
  on public.ronda_alertas (ronda_base_id, turno_id, ventana_inicio);

-- ── 3) Ventanas agrupadas en un episodio ─────────────────────────────────────
create table if not exists public.ronda_alerta_ventanas_episodio (
  id              uuid primary key default gen_random_uuid(),
  ronda_alerta_id uuid not null references public.ronda_alertas(id) on delete cascade,
  ronda_base_id   uuid not null,
  turno_id        uuid not null,
  tipo            text not null check (tipo in ('no_iniciada', 'no_finalizada')),
  ventana_inicio  timestamptz not null,
  ventana_fin     timestamptz not null,
  vencimiento_at  timestamptz not null,
  ejecucion_id    uuid,
  detectada_at    timestamptz not null default now(),
  -- Misma identidad que ronda_alertas_ventana_key: una ventana es una sola cosa.
  constraint ronda_alerta_ventanas_episodio_key unique (ronda_base_id, turno_id, ventana_inicio, tipo)
);
create index if not exists ronda_alerta_ventanas_episodio_alerta_idx
  on public.ronda_alerta_ventanas_episodio (ronda_alerta_id);

-- Sólo la escriben y leen funciones SECURITY DEFINER (y service_role).
alter table public.ronda_alerta_ventanas_episodio enable row level security;
revoke all on public.ronda_alerta_ventanas_episodio from public, anon, authenticated;

-- ── 4) resolver_ronda_alerta ─────────────────────────────────────────────────
-- Se reemplaza la firma de 3 argumentos por una con argumentos opcionales: una
-- llamada vieja (3 argumentos, posicional o por nombre) resuelve a ésta y se
-- comporta como antes. Conviviendo las dos firmas, la llamada sería ambigua.
drop function if exists public.resolver_ronda_alerta(uuid, text, text);

create or replace function public.resolver_ronda_alerta(
  p_alerta_id                uuid,
  p_accion                   text,
  p_comentario               text    default null,
  p_resultado                text    default null,
  p_motivo                   text    default null,
  p_seguimiento_minutos      integer default null,
  p_intervenciones_esperadas integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_usuario_id   uuid;
  v_alerta       record;
  v_comentario   text := btrim(coalesce(p_comentario, ''));
  v_cerrar       jsonb;
  v_cerrar_ctx   text;
  v_cierra       boolean;
  v_pendiente    boolean;
  v_nuevo        boolean := p_resultado is not null;
  v_cant         integer;
  v_ultima       jsonb;
  v_minutos      integer;
  v_hasta        timestamptz;
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

  if p_accion is null or p_accion not in ('llamada_vigilador', 'solicitud_cumplimiento',
                      'justificacion', 'cierre_administrativo', 'resuelta') then
    return jsonb_build_object('contexto', 'accion_invalida');
  end if;

  -- ── Validación del resultado (sólo clientes nuevos) ──────────────────────
  if v_nuevo then
    if p_resultado not in ('resuelto', 'seguimiento', 'no_resuelto') then
      return jsonb_build_object('contexto', 'resultado_invalido');
    end if;
    if p_motivo is null then
      return jsonb_build_object('contexto', 'motivo_requerido');
    end if;
    if p_motivo not in ('ronda_realizada', 'error_tecnico', 'administrativa', 'incumplimiento', 'otro') then
      return jsonb_build_object('contexto', 'motivo_invalido_resultado');
    end if;
    -- Combinaciones contradictorias: un incumplimiento no se "resuelve" y una
    -- justificación no confirma un incumplimiento (Cumplimiento la toma como
    -- saneada). El cierre administrativo es definitivo: no admite seguimiento.
    if (p_resultado = 'no_resuelto' and p_motivo not in ('incumplimiento', 'otro'))
       or (p_resultado = 'resuelto' and p_motivo = 'incumplimiento')
       or (p_accion = 'justificacion' and p_resultado <> 'resuelto')
       or (p_accion = 'cierre_administrativo' and p_resultado = 'seguimiento')
       or (p_accion = 'resuelta' and p_resultado <> 'resuelto') then
      return jsonb_build_object('contexto', 'combinacion_invalida');
    end if;
    if p_motivo = 'otro' and v_comentario = '' then
      return jsonb_build_object('contexto', 'comentario_requerido');
    end if;
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

  -- ── Idempotencia: el mismo clic repetido dentro de 60 s no se registra dos
  -- veces (se vieron 5–6 filas idénticas en el mismo minuto).
  if exists (
    select 1 from public.ronda_alerta_intervenciones i
     where i.ronda_alerta_id = v_alerta.id
       and i.supervisor_id   = v_usuario_id
       and i.accion          = p_accion
       and i.resultado is not distinct from p_resultado
       and i.motivo    is not distinct from p_motivo
       and coalesce(i.comentario, '') = v_comentario
       and i.created_at > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('contexto', 'duplicada', 'alerta_id', v_alerta.id,
                              'estado', v_alerta.estado);
  end if;

  -- Última intervención: viaja en 'conflicto' y 'ya_resuelta' para que la
  -- pantalla diga quién y qué hizo.
  select count(*) into v_cant from public.ronda_alerta_intervenciones i where i.ronda_alerta_id = v_alerta.id;
  select jsonb_build_object(
           'accion', i.accion, 'resultado', i.resultado, 'motivo', i.motivo,
           'origen', i.origen, 'comentario', i.comentario, 'created_at', i.created_at,
           'supervisor_nombre', case when u.id is null then null else u.apellido || ', ' || u.nombre end)
    into v_ultima
    from public.ronda_alerta_intervenciones i
    left join public.usuarios u on u.id = i.supervisor_id
   where i.ronda_alerta_id = v_alerta.id
   order by i.created_at desc
   limit 1;

  -- ── Bloqueo optimista: la pantalla dice cuántas intervenciones vio. Si la
  -- alerta cambió desde entonces no se pisa lo que hizo otro.
  if p_intervenciones_esperadas is not null
     and (v_cant <> p_intervenciones_esperadas or v_alerta.estado <> 'pendiente') then
    return jsonb_build_object('contexto', 'conflicto', 'alerta_id', v_alerta.id,
                              'estado', v_alerta.estado, 'intervenciones', v_cant,
                              'ultima_intervencion', v_ultima);
  end if;

  -- Idempotencia: una alerta ya resuelta no se reabre ni se re-registra.
  if v_alerta.estado = 'resuelta' then
    return jsonb_build_object('contexto', 'ya_resuelta', 'alerta_id', v_alerta.id,
                              'ultima_intervencion', v_ultima);
  end if;

  -- ══ Camino histórico (sin resultado): idéntico a 20260801150000 ══════════
  if not v_nuevo then
    v_cierra := p_accion in ('justificacion', 'cierre_administrativo', 'resuelta');

    if v_cierra and v_comentario = '' then
      return jsonb_build_object('contexto', 'comentario_requerido');
    end if;

    if p_accion = 'cierre_administrativo' then
      if v_alerta.ejecucion_id is null then
        return jsonb_build_object('contexto', 'cierre_no_aplicable', 'alerta_id', v_alerta.id);
      end if;
      v_cerrar := public.cerrar_ronda_bloqueada(v_alerta.ejecucion_id, v_comentario);
      v_cerrar_ctx := v_cerrar->>'contexto';
      if v_cerrar_ctx not in ('cerrada', 'ya_cerrada') then
        return jsonb_build_object('contexto', v_cerrar_ctx, 'alerta_id', v_alerta.id);
      end if;
      select (a.estado = 'pendiente') into v_pendiente from public.ronda_alertas a where a.id = v_alerta.id;
      if v_pendiente then
        insert into public.ronda_alerta_intervenciones
          (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
        values
          (v_alerta.id, v_usuario_id, 'cierre_administrativo', v_comentario, 'pendiente', 'resuelta');
        update public.ronda_alertas
           set estado = 'resuelta', resuelta_por = v_usuario_id, resuelta_at = now(),
               accion = 'cierre_administrativo', comentario = v_comentario, updated_at = now()
         where id = v_alerta.id;
      end if;
      return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
    end if;

    if not v_cierra then
      insert into public.ronda_alerta_intervenciones
        (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
      values
        (v_alerta.id, v_usuario_id, p_accion, nullif(v_comentario, ''), 'pendiente', 'pendiente');
      update public.ronda_alertas
         set accion = p_accion, comentario = nullif(v_comentario, ''), updated_at = now()
       where id = v_alerta.id;
      return jsonb_build_object('contexto', 'registrada', 'alerta_id', v_alerta.id);
    end if;

    insert into public.ronda_alerta_intervenciones
      (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo)
    values
      (v_alerta.id, v_usuario_id, p_accion, v_comentario, 'pendiente', 'resuelta');
    update public.ronda_alertas
       set estado = 'resuelta', resuelta_por = v_usuario_id, resuelta_at = now(),
           accion = p_accion, comentario = v_comentario, updated_at = now()
     where id = v_alerta.id;
    return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id);
  end if;

  -- ══ Camino nuevo: con resultado ══════════════════════════════════════════

  -- ── Seguimiento: queda pendiente con plazo. Uno solo por alerta.
  if p_resultado = 'seguimiento' then
    if exists (select 1 from public.ronda_alerta_intervenciones i
                where i.ronda_alerta_id = v_alerta.id and i.resultado = 'seguimiento') then
      return jsonb_build_object('contexto', 'requiere_resultado_definitivo', 'alerta_id', v_alerta.id,
                                'seguimiento_hasta', v_alerta.seguimiento_hasta);
    end if;
    v_minutos := coalesce(p_seguimiento_minutos, 120);
    if v_minutos < 15 or v_minutos > 240 then
      return jsonb_build_object('contexto', 'seguimiento_invalido');
    end if;
    v_hasta := now() + make_interval(mins => v_minutos);

    insert into public.ronda_alerta_intervenciones
      (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo,
       resultado, motivo, seguimiento_hasta)
    values
      (v_alerta.id, v_usuario_id, p_accion, nullif(v_comentario, ''), 'pendiente', 'pendiente',
       'seguimiento', p_motivo, v_hasta);
    update public.ronda_alertas
       set accion = p_accion, comentario = nullif(v_comentario, ''),
           resultado_intervencion = 'seguimiento', motivo_intervencion = p_motivo,
           seguimiento_hasta = v_hasta, updated_at = now()
     where id = v_alerta.id;
    return jsonb_build_object('contexto', 'seguimiento', 'alerta_id', v_alerta.id,
                              'seguimiento_hasta', v_hasta);
  end if;

  -- ── Cierre administrativo con resultado: la ejecución se cierra por su vía.
  if p_accion = 'cierre_administrativo' then
    if v_alerta.ejecucion_id is null then
      return jsonb_build_object('contexto', 'cierre_no_aplicable', 'alerta_id', v_alerta.id);
    end if;
    v_cerrar := public.cerrar_ronda_bloqueada(v_alerta.ejecucion_id, v_comentario);
    v_cerrar_ctx := v_cerrar->>'contexto';
    if v_cerrar_ctx not in ('cerrada', 'ya_cerrada') then
      return jsonb_build_object('contexto', v_cerrar_ctx, 'alerta_id', v_alerta.id);
    end if;
    select (a.estado = 'pendiente') into v_pendiente from public.ronda_alertas a where a.id = v_alerta.id;
    if v_pendiente then
      insert into public.ronda_alerta_intervenciones
        (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo, resultado, motivo)
      values
        (v_alerta.id, v_usuario_id, 'cierre_administrativo', v_comentario, 'pendiente', 'resuelta',
         p_resultado, p_motivo);
      update public.ronda_alertas
         set estado = 'resuelta', resuelta_por = v_usuario_id, resuelta_at = now(),
             accion = 'cierre_administrativo', comentario = v_comentario, updated_at = now()
       where id = v_alerta.id;
    end if;
    update public.ronda_alertas
       set resultado_intervencion = p_resultado, motivo_intervencion = p_motivo,
           seguimiento_hasta = null, updated_at = now()
     where id = v_alerta.id;
    return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id, 'resultado', p_resultado);
  end if;

  -- ── Resuelto / No resuelto: cierran la alerta. 'no_resuelto' es el
  -- incumplimiento confirmado: queda cerrada para no seguir avisando, con su
  -- resultado a la vista.
  insert into public.ronda_alerta_intervenciones
    (ronda_alerta_id, supervisor_id, accion, comentario, estado_anterior, estado_nuevo, resultado, motivo)
  values
    (v_alerta.id, v_usuario_id, p_accion, nullif(v_comentario, ''), 'pendiente', 'resuelta',
     p_resultado, p_motivo);
  update public.ronda_alertas
     set estado = 'resuelta', resuelta_por = v_usuario_id, resuelta_at = now(),
         accion = p_accion, comentario = nullif(v_comentario, ''),
         resultado_intervencion = p_resultado, motivo_intervencion = p_motivo,
         seguimiento_hasta = null, updated_at = now()
   where id = v_alerta.id;
  return jsonb_build_object('contexto', 'resuelta', 'alerta_id', v_alerta.id, 'resultado', p_resultado);
end;
$fn$;

revoke all on function public.resolver_ronda_alerta(uuid, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.resolver_ronda_alerta(uuid, text, text, text, text, integer, integer) to authenticated, service_role;

-- ── 5) evaluar_ronda_alertas ─────────────────────────────────────────────────
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

-- ── 6) listar_ronda_alertas_objetivo: campos nuevos ──────────────────────────
create or replace function public.listar_ronda_alertas_objetivo(p_objetivo_id uuid default null, p_estado text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
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
          'intervenciones',  coalesce(iv.total, 0),
          'resultado_intervencion', a.resultado_intervencion,
          'motivo_intervencion',    a.motivo_intervencion,
          'seguimiento_hasta',      a.seguimiento_hasta,
          'seguimiento_vencido',    (a.estado = 'pendiente' and a.seguimiento_hasta is not null
                                     and a.seguimiento_hasta <= now()),
          'ventanas_adicionales',   a.ventanas_adicionales,
          'ultima_ventana_inicio',  a.ultima_ventana_inicio,
          'ultima_intervencion',    iv.ultima
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
      left join lateral (
        select count(*) as total,
               (select jsonb_build_object(
                         'accion', i2.accion, 'resultado', i2.resultado, 'motivo', i2.motivo,
                         'origen', i2.origen, 'created_at', i2.created_at,
                         'supervisor_nombre', case when u2.id is null then null
                                                   else u2.apellido || ', ' || u2.nombre end)
                  from public.ronda_alerta_intervenciones i2
                  left join public.usuarios u2 on u2.id = i2.supervisor_id
                 where i2.ronda_alerta_id = a.id
                 order by i2.created_at desc
                 limit 1) as ultima
          from public.ronda_alerta_intervenciones i
         where i.ronda_alerta_id = a.id
      ) iv on true
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
$fn$;

commit;
